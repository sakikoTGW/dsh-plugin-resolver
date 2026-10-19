// Reloadable module: local dependencies carry this module's `?v=` query.
const __v = new URL(import.meta.url).searchParams.get('v') ?? ''
const __q = (name) => `./${name}${__v === '' ? '' : `?v=${encodeURIComponent(__v)}`}`
const { dshHome, dirExists, runProcess } = await import(__q('util.js'))
const { registryBase } = await import(__q('resolve.js'))
/**
 * Installation: drive the profile's plugin manager, build GitHub-only sources,
 * and verify what actually landed.
 *
 * The manager owns `package.json`, the lockfile and the activation lifecycle;
 * this module never edits profile files itself. Registry packages therefore go
 * straight through `installBundle`, and a source checkout is only ever handed
 * to it as a `link:` spec after the build produced the package's main entry.
 *
 * @module dsh-plugin-resolver/lib/install
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Longest a source install may run before the tool reports a timeout. */
const BUILD_TIMEOUT_MS = 20 * 60 * 1000
const TARBALL_TIMEOUT_MS = 5 * 60 * 1000

/**
 * The `pluginManager` service, or a clear failure.
 *
 * @param {any} ctx
 * @returns {any}
 */
export function managerOf(ctx) {
  const manager = ctx.get('pluginManager')
  if (!manager || typeof manager.installBundle !== 'function') {
    throw new Error('the pluginManager service is not mounted in this profile, so installs are unavailable')
  }
  return manager
}

/**
 * Condense one manager ChangeResult for tool output.
 *
 * @param {any} change
 * @returns {{applied: boolean, application: string, stage: string, error?: string, pendingBuilds: string[], logPath?: string, exitCode?: number}}
 */
export function summarizeChange(change) {
  const summary = {
    applied: change?.application === 'applied',
    application: String(change?.application ?? 'failed'),
    stage: String(change?.stage ?? 'install'),
    pendingBuilds: Array.isArray(change?.pendingBuilds) ? change.pendingBuilds : [],
    bundle: typeof change?.bundle === 'string' ? change.bundle : null,
  }
  if (change?.error) {
    const diagnostic = typeof change.error.diagnostic === 'string' ? change.error.diagnostic : ''
    summary.error = `${change.error.code ?? 'error'}${diagnostic ? `: ${tail(diagnostic, 700)}` : ''}`
  }
  if (change?.packageResult) {
    summary.logPath = change.packageResult.logPath
    summary.exitCode = change.packageResult.exitCode
    if (!summary.error && change.packageResult.exitCode !== 0) {
      summary.error = `pnpm exited ${change.packageResult.exitCode}: ${tail(change.packageResult.output, 700)}`
    }
  }
  return summary
}

/** Last `limit` characters, flattened. */
export function tail(text, limit) {
  const flat = String(text ?? '').trim()
  return flat.length <= limit ? flat : `…${flat.slice(-limit)}`
}

/**
 * Install one registry-resolved package spec.
 *
 * @param {any} manager
 * @param {{spec: string, registry?: string | null}} plan
 * @returns {Promise<{change: any, summary: ReturnType<typeof summarizeChange>}>}
 */
export async function installRegistry(manager, plan) {
  const options = { enabled: true }
  if (typeof plan.registry === 'string' && plan.registry !== '') options.registry = plan.registry
  const change = await manager.installBundle(plan.spec, options)
  return { change, summary: summarizeChange(change) }
}

/**
 * Read the installed package manifest through the profile's hoisted
 * `node_modules`, which also tells us whether the package declares a client
 * half. The profile directory comes from the environment when the host exposes
 * it; otherwise the standard `$DSH_HOME/profiles/<name>` layout is tried.
 *
 * @param {string} packageName
 * @returns {Promise<any | undefined>}
 */
export async function installedManifest(packageName) {
  const packageDir = await installedPackageDir(packageName)
  if (packageDir === undefined) return undefined
  try {
    return JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** Candidate profile directories, most specific first. */
function profileDirs() {
  const dirs = []
  if (process.env.DSH_PROFILE_DIR) dirs.push(process.env.DSH_PROFILE_DIR)
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : dshHome()
  if (home) {
    const profile = process.env.DSH_PROFILE && process.env.DSH_PROFILE !== '' ? process.env.DSH_PROFILE : 'desktop'
    for (const name of [profile, 'desktop', 'web']) dirs.push(path.join(home, 'profiles', name))
  }
  return [...new Set(dirs)]
}

/**
 * Locate an installed package directory without assuming one profile layout.
 * @param {string} packageName
 * @returns {Promise<string | undefined>}
 */
export async function installedPackageDir(packageName) {
  for (const profileDir of profileDirs()) {
    const candidate = path.join(profileDir, 'node_modules', packageName)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Runtime files that decide whether the loaded code actually changed. */
async function hashRuntimeFiles(dir) {
  const files = []
  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'test' || entry.name === 'tests' || entry.name === 'fixtures' || entry.name === 'examples' || entry.name === '.git' || entry.name === '.github') continue
      if (/^(license|notice|readme)/i.test(entry.name)) continue
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (ext === '.md' || ext === '.markdown' || ext === '.map' || ext === '.d.ts' || ext === '.pdb') continue
      if (entry.name === 'package.json') continue
      try {
        files.push(`${path.relative(dir, abs).split(path.sep).join('/')}:${sha256(await readFile(abs))}`)
      } catch {
        // unreadable runtime file: treating it as absent is safer than crashing
      }
    }
  }
  await walk(dir)
  files.sort()
  return files
}

/**
 * Snapshot the installed package's runtime identity. README/docs and the
 * version field are excluded: those changes do not alter loaded code.
 * @param {string} packageName
 * @returns {Promise<{version: string, hash: string, clientHash: string, hasClient: boolean, dir: string} | null>}
 */
export async function capturePackageRuntime(packageName) {
  const dir = await installedPackageDir(packageName)
  if (dir === undefined) return null
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const files = await hashRuntimeFiles(dir)
    const meta = {
      main: manifest.main ?? null,
      exports: manifest.exports ?? null,
      dsh: manifest.dsh ?? null,
      dependencies: manifest.dependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
    }
    const clientFiles = files.filter((line) => /(^|[/\\])[^/\\]*client[^/\\]*\.(?:js|mjs|cjs|ts):/i.test(line))
    return {
      version: String(manifest.version ?? ''),
      hash: sha256(`${JSON.stringify(meta)}\n${files.join('\n')}`),
      clientHash: sha256(clientFiles.join('\n')),
      hasClient: Boolean(manifest.dsh?.client),
      dir,
    }
  } catch {
    return null
  }
}

/**
 * Decide whether install results really require a restart. Changed runtime or
 * client files do; no-op reinstall and metadata-only version bumps do not. A
 * bundle-set change only needs a restart when the manager could not apply it in
 * place — a live profile recomposes and mounts the new bundle itself, in which
 * case an added client half asks for a GUI refresh instead.
 * @param {{before: any, after: any, bundlesBefore: string[], bundlesAfter: string[], managerApplication: string}} input
 */
export function decideRestart({ before, after, bundlesBefore, bundlesAfter, managerApplication }) {
  const beforeNames = new Set(bundlesBefore ?? [])
  const afterNames = new Set(bundlesAfter ?? [])
  const added = [...afterNames].filter((name) => !beforeNames.has(name))
  const removed = [...beforeNames].filter((name) => !afterNames.has(name))
  if (added.length > 0 || removed.length > 0) {
    const changed = [...added, ...removed].join(', ')
    if (managerApplication === 'applied') {
      return { required: false, reason: `manager applied the bundle set change in place (${changed})`, bundleChanged: true, codeChanged: true, clientChanged: Boolean(added.length > 0 && after?.hasClient), versionChanged: false }
    }
    return { required: true, reason: `bundle set changed (${changed})`, bundleChanged: true, codeChanged: true, clientChanged: false, versionChanged: false }
  }
  if (!before || !after) {
    const required = managerApplication === 'restart-required'
    return { required, reason: required ? 'manager requested a restart (no runtime snapshot)' : 'manager applied it in place', bundleChanged: false, codeChanged: false, clientChanged: false, versionChanged: false }
  }
  const versionChanged = before.version !== after.version
  const codeChanged = before.hash !== after.hash
  const clientChanged = Boolean(before.hasClient && after.hasClient && before.clientHash !== after.clientHash)
  if (!codeChanged) {
    return { required: false, reason: versionChanged ? 'runtime files are unchanged (version label only)' : 'runtime files are unchanged', bundleChanged: false, codeChanged: false, clientChanged: false, versionChanged }
  }
  if (managerApplication === 'applied') {
    return { required: false, reason: 'manager applied the change in place', bundleChanged: false, codeChanged: true, clientChanged, versionChanged }
  }
  return { required: true, reason: clientChanged ? 'client half changed' : 'runtime code changed', bundleChanged: false, codeChanged: true, clientChanged, versionChanged }
}

/**
 * Verify a package after installation: loader entry, bundle selection, and
 * whether a client half exists (asked of the live client module table first,
 * because that is what actually decides whether a refresh will show it).
 *
 * @param {any} ctx
 * @param {any} manager
 * @param {string} packageName
 * @returns {Promise<{entry?: any, bundle?: any, manifest?: any, hasClient: boolean, clientSource: string}>}
 */
export async function verifyInstall(ctx, manager, packageName) {
  let entry
  let bundle
  try {
    const plugins = await manager.listPlugins()
    entry = plugins.find(
      (plugin) =>
        plugin.moduleName === packageName ||
        (typeof plugin.moduleName === 'string' && plugin.moduleName.endsWith(`/${packageName}`)),
    )
  } catch {
    entry = undefined
  }
  try {
    const bundles = await manager.listBundles()
    bundle = bundles.find((item) => item.name === packageName)
  } catch {
    bundle = undefined
  }
  let hasClient = false
  let clientSource = 'none'
  const clientModules = ctx.get('clientModules')
  if (clientModules && typeof clientModules.clientPath === 'function') {
    try {
      hasClient = Boolean(clientModules.clientPath(packageName))
      if (hasClient) clientSource = 'client table'
    } catch {
      // fall through to the manifest
    }
  }
  const manifest = await installedManifest(packageName)
  if (!hasClient && manifest?.dsh?.client) {
    hasClient = true
    clientSource = 'manifest'
  }
  return { entry, bundle, manifest, hasClient, clientSource }
}

/** Locate a pnpm executable usable for a source build. */
export function resolvePnpm() {
  const explicit = process.env.DSH_PNPM_PATH
  if (typeof explicit === 'string' && explicit !== '' && existsSync(explicit)) return explicit
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Ensure the GitHub checkout exists, downloading the repository tarball once.
 *
 * @param {{repo: string, ref: string | null}} plan
 * @param {{githubProxy?: string}} options
 * @returns {Promise<{dir: string, from: 'checkout' | 'download'}>}
 */
export async function ensureCheckout(plan, options = {}) {
  const slug = plan.repo
  const safe = slug.replace(/[^A-Za-z0-9._-]+/g, '__')
  const root = path.join(dshHome(), 'plugin-sources', safe)
  if (dirExists(path.join(root, 'package.json')) || dirExists(path.join(root, '.git'))) {
    return { dir: root, from: 'checkout' }
  }
  const refs = plan.ref ? [plan.ref] : ['main', 'master']
  const attempts = []
  for (const ref of refs) {
    const urls = [`https://codeload.github.com/${slug}/tar.gz/refs/heads/${ref}`]
    if (options.githubProxy) urls.push(`${options.githubProxy.replace(/\/+$/, '')}/${urls[0]}`)
    for (const url of urls) {
      try {
        const bytes = await download(url)
        const temp = path.join(dshHome(), 'cache', 'plugin-resolver', `src-${safe}-${Date.now()}`)
        await rm(temp, { recursive: true, force: true })
        await mkdir(temp, { recursive: true })
        const tarball = path.join(temp, 'repo.tar.gz')
        await writeFile(tarball, bytes)
        const extractDir = path.join(temp, 'extract')
        await mkdir(extractDir, { recursive: true })
        const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
        const extracted = await runProcess(tar, ['-xzf', tarball, '-C', extractDir], { timeoutMs: 120_000 })
        if (extracted.code !== 0) throw new Error(`tar exited ${extracted.code}`)
        const children = (await readdir(extractDir, { withFileTypes: true })).filter((item) => item.isDirectory())
        if (children.length !== 1) throw new Error('unexpected tarball layout')
        await rm(root, { recursive: true, force: true })
        await mkdir(path.dirname(root), { recursive: true })
        await rename(path.join(extractDir, children[0].name), root)
        await rm(temp, { recursive: true, force: true })
        return { dir: root, from: 'download' }
      } catch (error) {
        attempts.push(`${url} -> ${error.message}`)
      }
    }
  }
  throw new Error(`could not download ${slug}: ${attempts.join(' | ')}`)
}

/** Download a URL into memory with a bounded timeout. */
async function download(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TARBALL_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build a GitHub-only plugin from its checkout when the package ships no
 * built output, then install it as a `link:` package.
 *
 * @param {any} manager
 * @param {any} plan a resolution of kind `github`
 * @param {{githubProxy?: string, skipBuild?: boolean, log?: (line: string) => void}} options
 * @returns {Promise<{packageName: string, packageDir: string, built: boolean, steps: string[], change: any, summary: ReturnType<typeof summarizeChange>}>}
 */
export async function installGithubSource(manager, plan, options = {}) {
  const log = options.log ?? (() => {})
  const steps = []
  const checkout = await ensureCheckout(plan, options)
  steps.push(`checkout: ${checkout.dir} (${checkout.from})`)
  log(`${checkout.from === 'download' ? 'download' : 'reuse'} ${plan.repo}`)

  const packageDir = plan.subpath ? path.join(checkout.dir, plan.subpath) : checkout.dir
  if (!dirExists(packageDir)) throw new Error(`subpath "${plan.subpath}" does not exist in ${plan.repo}`)
  const manifestPath = path.join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`${packageDir} has no package.json`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const packageName = typeof manifest.name === 'string' ? manifest.name : null
  if (!packageName) throw new Error(`${manifestPath} has no package name`)

  const mainEntry = typeof manifest.main === 'string' && manifest.main !== '' ? manifest.main : 'index.js'
  const builtPath = path.join(packageDir, mainEntry)
  let built = existsSync(builtPath)
  if (!built && options.skipBuild === true) {
    throw new Error(`${packageName} ships no build output (${mainEntry} missing) and building was disabled`)
  }
  if (!built) {
    if (!manifest.scripts || typeof manifest.scripts.build !== 'string') {
      throw new Error(
        `${packageName} ships no build output and declares no "build" script; nothing this plugin can build automatically`,
      )
    }
    const pnpm = resolvePnpm()
    const registry = registryBase(plan.registry)
    const env = { npm_config_registry: registry, CI: '1' }
    const install = await runProcess(pnpm, ['install', '--no-frozen-lockfile'], {
      cwd: checkout.dir,
      env,
      timeoutMs: BUILD_TIMEOUT_MS,
      onLine: log,
    })
    if (install.code !== 0) {
      throw new Error(`dependency install failed (exit ${install.code}): ${tail(install.output, 900)}`)
    }
    steps.push(`deps: pnpm install in ${checkout.dir}`)
    const build = await runProcess(pnpm, ['run', 'build'], {
      cwd: packageDir,
      env,
      timeoutMs: BUILD_TIMEOUT_MS,
      onLine: log,
    })
    if (build.code !== 0) {
      throw new Error(`build failed (exit ${build.code}): ${tail(build.output, 900)}`)
    }
    steps.push(`build: pnpm run build in ${packageDir}`)
    built = existsSync(builtPath)
    if (!built) throw new Error(`build finished but ${mainEntry} still does not exist`)
  }
  log(`install link:${packageDir}`)
  const change = await manager.installBundle(`link:${packageDir}`, { enabled: true })
  steps.push(`install: link:${packageDir}`)
  return { packageName, packageDir, built, steps, change, summary: summarizeChange(change) }
}

