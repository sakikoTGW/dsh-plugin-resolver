/**
 * Host-free harness: mount the tool set against a fake Cordis context and a
 * fake plugin manager, then drive the real tool bodies. This is where the
 * resolution rules, ambiguity handling and install orchestration get checked
 * without touching the profile.
 *
 * Run with: node test/harness.mjs
 */

import assert from 'node:assert/strict'
import { loadLogic, logicVersion, registerTools } from '../host/register.js'

const calls = []
const installed = {
  bundles: [
    { name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true, installed: false, optional: false, rows: [] },
    { name: '@deepseek-ai/dsh-web-app', version: '0.2.0-rc.2', enabled: true, installed: false, optional: false, rows: [] },
    {
      name: 'dsh-better-sidebar',
      version: '0.26.1',
      enabled: true,
      installed: true,
      optional: false,
      rows: [{ rowId: 'better-sidebar', moduleName: 'dsh-better-sidebar', entryId: 'include:better-sidebar' }],
    },
  ],
  plugins: [
    { entryId: 'include:better-sidebar', moduleName: 'dsh-better-sidebar', enabled: true, fiberPhase: 'active' },
    { entryId: 'include:web-startup', moduleName: '@deepseek-ai/dsh-web-app/startup', enabled: true, fiberPhase: 'active' },
  ],
}

const manager = {
  async listBundles() {
    return installed.bundles
  },
  async listPlugins() {
    return installed.plugins
  },
  async registries() {
    return { registry: 'https://registry.npmjs.org', fallbackRegistries: [], resolved: 'https://registry.npmmirror.com' }
  },
  async installBundle(spec, options) {
    calls.push({ spec, options })
    const bundle = spec.includes('@') ? spec.slice(0, spec.lastIndexOf('@')) : spec
    installed.bundles.push({
      name: bundle,
      version: 'mock',
      enabled: true,
      installed: true,
      optional: false,
      rows: [{ rowId: 'mock', moduleName: bundle, entryId: 'include:mock' }],
    })
    installed.plugins.push({ entryId: 'include:mock', moduleName: bundle, enabled: true, fiberPhase: 'active' })
    return { application: 'applied', stage: 'install', changed: true, bundle, warnings: [] }
  },
}

const ctx = {
  get(name) {
    if (name === 'pluginManager') return manager
    if (name === 'pluginRegistryProbe') return { fastest: async () => 'https://registry.npmmirror.com' }
    return undefined
  },
  effect(fn) {
    fn()
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
}

const tools = new Map()
registerTools(ctx, {})
assert.deepEqual([...tools.keys()].sort(), ['plugin_install', 'plugin_resolve', 'plugin_search', 'plugin_status'])

let failures = 0
async function check(label, fn) {
  try {
    await fn()
    console.log(`ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${label}: ${error.message}`)
  }
}

const run = async (name, args) => {
  const result = await tools.get(name).execute(args, { signal: AbortSignal.timeout(120_000) })
  return typeof result === 'string' ? result : result.text
}

await check('logic entry is reloadable under a cache-busting URL', async () => {
  assert.match(logicVersion(), /^\d+$/)
  const first = await loadLogic()
  const second = await loadLogic()
  assert.equal(typeof first.pluginSearch, 'function')
  assert.equal(first, second, 'same mtime must reuse the same module URL')
  const a = await import(new URL('../logic/semver.js?v=probe-a', import.meta.url).href)
  const b = await import(new URL('../logic/semver.js?v=probe-b', import.meta.url).href)
  assert.notEqual(a.satisfies, b.satisfies, 'a changed query must produce a fresh module instance')
})

await check('resolve picks the DSH-compatible version line', async () => {
  const text = await run('plugin_resolve', { target: 'dsh-better-sidebar' })
  assert.match(text, /0\.26\.1/)
  assert.doesNotMatch(text, /no version compatible/)
})

await check('resolve honors an engines.dsh-only plugin', async () => {
  const text = await run('plugin_resolve', { target: 'dsh-builtin-browser' })
  assert.match(text, /0\.4\./)
  assert.doesNotMatch(text, /no version compatible/)
})

await check('resolve surfaces same-name ambiguity instead of guessing', async () => {
  const text = await run('plugin_resolve', { target: 'dsh-browser' })
  assert.match(text, /ambiguous/i)
  assert.match(text, /owner=/)
})

await check('resolve disambiguates by owner', async () => {
  const text = await run('plugin_resolve', { target: 'dsh-browser', owner: 'wqty123' })
  assert.match(text, /dsh-builtin-browser/)
  assert.doesNotMatch(text, /ambiguous/i)
})

await check('search ranks and flags ambiguity', async () => {
  const text = await run('plugin_search', { query: 'better-sidebar', limit: 5 })
  assert.match(text, /dsh-better-sidebar/)
  assert.match(text, /installed/)
})

await check('status lists third-party bundles and entries', async () => {
  const text = await run('plugin_status', {})
  assert.match(text, /dsh-better-sidebar@0\.26\.1/)
  assert.match(text, /include:better-sidebar/)
})

await check('install pins the resolved version and passes the mirror registry', async () => {
  calls.length = 0
  const text = await run('plugin_install', { target: 'dsh-better-sidebar' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].spec, 'dsh-better-sidebar@0.26.1')
  assert.equal(calls[0].options.registry, 'https://registry.npmmirror.com')
  assert.match(text, /install: applied/)
  assert.match(text, /verification:/)
})

await check('ambiguous install refuses to guess', async () => {
  calls.length = 0
  const text = await run('plugin_install', { target: 'dsh-browser' })
  assert.equal(calls.length, 0)
  assert.match(text, /ambiguous/i)
})

await check('github spec resolves to a source-build plan', async () => {
  calls.length = 0
  const text = await run('plugin_resolve', {
    target: 'github:omdsh-dev/dsh-browser#path:/packages/browser/bridge-browser',
  })
  assert.match(text, /target kind: github/)
  assert.match(text, /packages\/browser\/bridge-browser/)
  assert.equal(calls.length, 0)
})

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall harness checks passed')

