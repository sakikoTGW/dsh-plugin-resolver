/**
 * Ablation runs: remove one capability at a time and measure what it costs.
 *
 * Everything here is executed against the real catalog, the real npm registry
 * and the real runner-lite logic of this plugin, with one deliberate
 * difference per section: the capability under test is replaced by the naive
 * behaviour a session without the plugin would have.
 *
 * Run with:  node test/ablation.mjs
 * Output:    human-readable table plus one JSON summary line (`--json`).
 */

import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { compareVersions, satisfies } from '../logic/semver.js'
import { chooseCompatibleVersion } from '../logic/resolve.js'
import { loadCatalog, searchCatalog, baseName } from '../logic/catalog.js'
import { registerTools } from '../host/register.js'

/** The host this repository is developed against. */
const RUNNING_DSH = process.env.DSH_ABLATION_RUNTIME ?? '0.2.0-rc.2'
const RUNTIME_NOTE = `runtime=${RUNNING_DSH}`

const json = process.argv.includes('--json')
const report = { runtime: RUNNING_DSH, sections: [], summary: [] }

function section(id, title, lines, data) {
  report.sections.push({ id, title, lines, data })
  if (!json) {
    console.log(`\n## ${id}  ${title}`)
    for (const line of lines) console.log(line)
  }
}

function summary(key, value) {
  report.summary.push({ key, value })
  if (!json) console.log(`   ⇒ ${key}: ${value}`)
}

/** Fetch JSON with a bounded timeout; never throws. */
async function fetchJsonBounded(url, timeoutMs = 12_000) {
  const started = performance.now()
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-resolver-ablation' },
    })
    if (!response.ok) return { ok: false, ms: Math.round(performance.now() - started), error: `HTTP ${response.status}` }
    return { ok: true, ms: Math.round(performance.now() - started), data: await response.json() }
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - started), error: error?.name ?? String(error) }
  }
}

// ---------------------------------------------------------------------------
// A. Same-name disambiguation removed: "pick the first/top-star hit".
// ---------------------------------------------------------------------------
{
  const catalog = await loadCatalog({ catalogTtlMs: 12 * 60 * 60 * 1000 })
  const byBase = new Map()
  for (const entry of catalog.entries) {
    const key = baseName(entry).toLowerCase()
    const list = byBase.get(key) ?? []
    list.push(entry)
    byBase.set(key, list)
  }
  const ambiguous = [...byBase.values()].filter((list) => list.length > 1)
  let wouldMisroute = 0
  for (const list of ambiguous) {
    const topStar = [...list].sort((a, b) => b.stars - a.stars)[0]
    const hasNpmSibling = list.some((entry) => entry.npm !== null)
    if (topStar.npm === null && hasNpmSibling) wouldMisroute += 1
  }
  const probe = 'dsh-browser'
  const matches = (byBase.get(probe) ?? []).length
  section(
    'A1',
    '同名消歧：去掉 owner/星数/来源区分 → 按"第一个命中"装',
    [
      `目录条目 ${catalog.entries.length} 条；同名（base name 相同）分组 ${ambiguous.length} 组`,
      `其中「星数最高的是 GitHub-only、但同组还有 npm 包」的分组 ${wouldMisroute} 组——naive 选择会装到另一条来源`,
      `查询 "${probe}"：同名条目 ${matches} 条；本插件返回 owner=… 让调用方显式选择，naive 只会给第一条`,
    ],
    { entries: catalog.entries.length, ambiguousGroups: ambiguous.length, wouldMisroute, probeMatches: matches },
  )
  summary('同名分组', `${ambiguous.length}`)
  summary('naive 会选错的组', `${wouldMisroute} / ${ambiguous.length}`)
}

/** All published versions, newest first. */
function publishedVersions(doc) {
  return Object.keys(doc.versions)
    .filter((version) => /^\d+\.\d+\.\d+/.test(version))
    .sort((a, b) => compareVersions(b, a))
}

/** Pick the newest version under a configurable "counts as a runtime peer" rule. */
function chooseWithPeerRule(doc, runtime, isRuntimePeer) {
  for (const version of publishedVersions(doc)) {
    const manifest = doc.versions[version] ?? {}
    if (manifest.deprecated) continue
    const peers = manifest.peerDependencies ?? {}
    const optional = manifest.peerDependenciesMeta ?? {}
    let ok = true
    for (const [peer, range] of Object.entries(peers)) {
      if (!isRuntimePeer(peer) || optional[peer]?.optional) continue
      if (typeof range === 'string' && range !== '' && !satisfies(runtime, range)) {
        ok = false
        break
      }
    }
    if (ok && typeof manifest.engines?.dsh === 'string' && !satisfies(runtime, manifest.engines.dsh)) ok = false
    if (ok) return version
  }
  return null
}

/** The rule this plugin uses: only the Host's own dsh packages carry runtime versions. */
const isDshRuntimePeer = (name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
/** The naive rule: every `@deepseek-ai/*` peer looks like a runtime version (the real bug). */
const isAnyDeepseekPeer = (name) => name.startsWith('@deepseek-ai/')

// ---------------------------------------------------------------------------
// B + G. Version selection and peer-scope removed / broadened.
// ---------------------------------------------------------------------------
{
  const cases = [
    { name: 'dsh-better-sidebar' },
    { name: 'dsh-builtin-browser' },
    { name: 'dshmarket' },
    { name: 'dsh-find-plugin' },
    { name: 'dsh-plugin-subscriptions' },
    { name: '@anweat/dsh-browser' },
    { name: 'dsh-config-manager' },
    { name: '@noob-stupid/dsh-plugin-console' },
  ]
  const rows = []
  for (const item of cases) {
    const meta = await fetchJsonBounded(`https://registry.npmmirror.com/${item.name}`)
    if (!meta.ok) {
      rows.push({ name: item.name, note: `registry lookup ${meta.error} (${meta.ms} ms)` })
      continue
    }
    const doc = { versions: meta.data.versions ?? {}, tags: meta.data['dist-tags'] ?? {} }
    const latest = doc.tags.latest ?? null
    const chosen = chooseCompatibleVersion(doc, RUNNING_DSH)
    const chosenVersion = chosen.version
    const latestManifest = latest ? doc.versions[latest] ?? {} : {}
    const latestOk = latest ? chooseCompatibleVersion({ versions: { [latest]: latestManifest }, tags: {} }, RUNNING_DSH).version === latest : false

    // G: broaden the peer filter to every @deepseek-ai/* package (the real bug
    // this repository hit) and re-run the same selection.
    const versions = publishedVersions(doc)
    const naivePick = chooseWithPeerRule(doc, RUNNING_DSH, isAnyDeepseekPeer)
    const correctPick = chooseWithPeerRule(doc, RUNNING_DSH, isDshRuntimePeer)
    const skippedCount = correctPick ? versions.indexOf(correctPick) : versions.length
    rows.push({
      name: item.name,
      latest,
      latestOk,
      chosen: correctPick ?? chosenVersion,
      correctPick,
      skippedCount,
      skipped: chosen.rejected.map((r) => `${r.version} (${r.reason})`).slice(0, 2),
      naivePick,
    })
  }
  const measured = rows.filter((row) => row.note === undefined)
  const incompatibleLatest = measured.filter((row) => row.latestOk === false).length
  const naiveFalseReject = measured.filter((row) => row.chosen && row.naivePick === null).length
  const naiveWrongPick = measured.filter((row) => row.chosen && row.naivePick && row.naivePick !== row.chosen).length
  const totalSkipped = measured.reduce((sum, row) => sum + (row.skippedCount ?? 0), 0)
  section(
    'A2',
    '版本兼容判定：去掉 peer/engines 解析 → 直接装 latest',
    [
      `${RUNTIME_NOTE}；样本 ${measured.length} 个真实 npm 包（各拉一次 registry 元数据）`,
      `latest 与宿主不兼容、直接装 latest 会装坏的：${incompatibleLatest} / ${measured.length}`,
      `把 peer 过滤放大成"所有 @deepseek-ai/*"（曾经的实现 bug）后：${naiveFalseReject} 个包会被误判为"无兼容版本"，${naiveWrongPick} 个会选错版本`,
      `为挑到可装版本，本插件累计跳过了 ${totalSkipped} 个更新的版本（并逐个给出拒绝原因）`,
      ...rows.map((row) =>
        row.note
          ? `- ${row.name}: ${row.note}`
          : `- ${row.name}: latest=${row.latest ?? '?'} (${row.latestOk ? '兼容' : '不兼容'})；本插件选 ${row.chosen ?? '无'}（跳过 ${row.skippedCount} 个）；naive 选 ${row.naivePick ?? '无'}`,
      ),
    ],
    { rows, incompatibleLatest, naiveFalseReject, naiveWrongPick, totalSkipped },
  )
  summary('latest 不可用', `${incompatibleLatest} / ${measured.length}`)
  summary('naive 误判"无兼容版本"', `${naiveFalseReject} / ${measured.length}`)
  summary('累计跨过的更新版本', `${totalSkipped}`)
}

// ---------------------------------------------------------------------------
// C. Registry choice removed: default to registry.npmjs.org.
// ---------------------------------------------------------------------------
{
  const target = 'dsh-better-sidebar'
  const npmjs = await fetchJsonBounded(`https://registry.npmjs.org/${target}`, 25_000)
  const mirror = await fetchJsonBounded(`https://registry.npmmirror.com/${target}`, 25_000)
  const rows = [
    { registry: 'registry.npmjs.org', ok: npmjs.ok, ms: npmjs.ms, error: npmjs.error },
    { registry: 'registry.npmmirror.com', ok: mirror.ok, ms: mirror.ms, error: mirror.error },
  ]
  section(
    'A3',
    '注册表选择：去掉最快 registry 探测 → 直连 npmjs',
    [
      `同一份元数据（${target}）单次读取：`,
      ...rows.map((row) => `- ${row.registry}: ${row.ok ? `${row.ms} ms` : `失败 ${row.error}（${row.ms} ms）`}`),
      '会话实测的安装面（BENCHMARK.md 记录）：npmjs 两次 90 s 超时失败；镜像 13.4 s 成功装完 170 个包。',
    ],
    { rows, recorded: { npmjsTimeoutsMs: [90_103, 90_145], mirrorInstallMs: 13_400 } },
  )
  if (npmjs.ok && mirror.ok) summary('元数据延迟比', `${(npmjs.ms / Math.max(mirror.ms, 1)).toFixed(1)}×（npmjs/mirror）`)
}

// ---------------------------------------------------------------------------
// D. Source-build capability removed: GitHub-only package with no build output.
// ---------------------------------------------------------------------------
{
  const rawBase = 'https://raw.githubusercontent.com/omdsh-dev/dsh-browser/main/packages/browser/bridge-browser'
  const probes = []
  for (const file of ['lib/index.js', 'package.json', 'src/index.ts']) {
    const started = performance.now()
    try {
      const response = await fetch(`${rawBase}/${file}`, { signal: AbortSignal.timeout(10_000) })
      probes.push({ file, status: response.status, ms: Math.round(performance.now() - started) })
    } catch (error) {
      probes.push({ file, status: null, ms: Math.round(performance.now() - started), error: error?.name ?? String(error) })
    }
  }
  const entryProbe = probes.find((probe) => probe.file === 'lib/index.js')
  const sourceProbe = probes.find((probe) => probe.file === 'src/index.ts')
  section(
    'A4',
    '源码构建：去掉"检出 → pnpm install → build → link:" 这一步',
    [
      `GitHub-only 样本 omdsh-dev/dsh-browser（桥接插件）仓库内探针：`,
      ...probes.map((probe) => `- ${probe.file}: ${probe.status ?? probe.error}`),
      entryProbe?.status === 404
        ? '构建产物 lib/index.js 不在仓库里：直接 `dsh plugin add github:…` 装进去，包声明的入口不存在，插件无法加载'
        : '仓库里能直接拿到构建产物（本次探针未证实缺失）',
      sourceProbe?.status === 200 ? '源码 src/index.ts 存在 → 需要本地编译，本插件自动执行这一步' : '源码探针未能确认',
    ],
    { probes, entryMissing: entryProbe?.status === 404 },
  )
  summary('GitHub-only 入口缺失', entryProbe?.status === 404 ? '是（不构建=装不上）' : '未证实')
}

// ---------------------------------------------------------------------------
// E. Post-install verification removed: trust the installer's "applied".
// ---------------------------------------------------------------------------
{
  const tools = new Map()
  const fakeManager = {
    async listBundles() {
      return [{ name: '@deepseek-ai/dsh-base', version: RUNNING_DSH, enabled: true, installed: false, optional: false, rows: [] }]
    },
    async listPlugins() {
      // The installer claims success, but nothing mounted.
      return []
    },
    async registries() {
      return { registry: 'https://registry.npmjs.org', fallbackRegistries: [], resolved: 'https://registry.npmmirror.com' }
    },
    async installBundle() {
      return { application: 'applied', stage: 'install', changed: true, bundle: 'dsh-better-sidebar', warnings: [] }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'pluginManager') return fakeManager
      if (name === 'pluginRegistryProbe') return { fastest: async () => 'https://registry.npmmirror.com' }
      return undefined
    },
    effect(fn) {
      fn()
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
  }
  registerTools(ctx, {})
  const result = await tools.get('plugin_install').execute(
    { target: 'dsh-better-sidebar@0.26.1' },
    { signal: AbortSignal.timeout(120_000) },
  )
  const text = result.text
  const detected = /loader entry: not found/.test(text) && /restart/.test(text)
  section(
    'A5',
    '安装后校验：去掉 loader entry / client 半回读 → 相信"installed"',
    [
      '模拟"安装器报告 applied、但当前进程里没有该 entry"：',
      '- 无校验的路径：会告诉用户"安装成功"',
      `- 本插件：${detected ? '在同一调用里报出 loader entry: not found 并给出重启提示' : '未按预期报出异常'}`,
      `- 检测到的输出片段：${text.split('\n').filter((line) => /loader entry|next:/.test(line)).join(' | ')}`,
    ],
    { detected },
  )
  summary('静默失败可检测', detected ? '是' : '否')
}

// ---------------------------------------------------------------------------
// F. Reloadable logic removed: every logic edit needs a host restart.
// ---------------------------------------------------------------------------
{
  const started = performance.now()
  const a = await import(new URL('../logic/semver.js?v=ablation-a', import.meta.url).href)
  const b = await import(new URL('../logic/semver.js?v=ablation-b', import.meta.url).href)
  const reloadMs = Math.round(performance.now() - started)
  const distinct = a.satisfies !== b.satisfies
  section(
    'A6',
    '逻辑热加载：去掉 cache-busted 重新 import → 改一行代码就重启宿主',
    [
      `带新 query 重新加载逻辑模块：${reloadMs} ms（本次进程内实测）`,
      `两次加载是不同模块实例：${distinct ? '是' : '否'}`,
      '对照：会话实测的"改代码 → 重启 DSH → 重新加载"约为 30–40 s，且会中断进行中的回合（今天为此重启了 3 次）',
    ],
    { reloadMs, distinct, recorded: { restartMs: 30_000, restartsThisSession: 3 } },
  )
  summary('热加载耗时', `${reloadMs} ms（vs 重启 ~30 s）`)
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('\n## 汇总')
  for (const item of report.summary) console.log(`- ${item.key}: ${item.value}`)
  console.log(`\n运行环境：${RUNTIME_NOTE}；本脚本无副作用（不安装、不改 profile）。`)
}

assert.ok(report.sections.length === 6, 'expected six ablation sections')
