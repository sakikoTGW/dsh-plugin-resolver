/**
 * Benchmark harness: drive the real tool surface against a fake host and record
 * wall time, network calls and output size per task. This measures the plugin
 * path only; the manual-baseline numbers live in BENCHMARK.md and come from
 * session logs (registry timeouts, catalog download, source builds).
 *
 * Run with: node test/benchmark.mjs
 */

import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { registerTools } from '../host/register.js'

// --- fetch instrumentation (must be installed before the logic modules run) --
const realFetch = globalThis.fetch
let fetchCount = 0
globalThis.fetch = (...args) => {
  fetchCount += 1
  return realFetch(...args)
}

// --- fake host --------------------------------------------------------------
const bundleRows = [
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
]
const entryRows = [
  { entryId: 'include:better-sidebar', moduleName: 'dsh-better-sidebar', enabled: true, fiberPhase: 'active' },
]
const installCalls = []
const manager = {
  async listBundles() {
    return bundleRows
  },
  async listPlugins() {
    return entryRows
  },
  async registries() {
    return { registry: 'https://registry.npmjs.org', fallbackRegistries: [], resolved: 'https://registry.npmmirror.com' }
  },
  async installBundle(spec, options) {
    installCalls.push({ spec, options })
    return { application: 'applied', stage: 'install', changed: true, bundle: 'dsh-better-sidebar', warnings: [] }
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

// --- task runner ------------------------------------------------------------
const results = []
async function measure(label, tool, args) {
  const before = fetchCount
  const started = performance.now()
  const result = await tools.get(tool).execute(args, { signal: AbortSignal.timeout(600_000) })
  const ms = performance.now() - started
  const text = typeof result === 'string' ? result : result.text
  results.push({ label, tool, ms: Math.round(ms), fetches: fetchCount - before, chars: text.length })
  return text
}

const cold = await measure('catalog cold load (npm carrier)', 'plugin_search', { query: 'sidebar', limit: 3, refresh: true })
assert.match(cold, /catalog \d+ entries/)
const ambiguous = await measure('search same-name ambiguity', 'plugin_search', { query: 'dsh-browser', limit: 6 })
assert.match(ambiguous, /6 match/)
await measure('search cached', 'plugin_search', { query: 'browser', limit: 6 })
const ambiguity = await measure('resolve ambiguous target', 'plugin_resolve', { target: 'dsh-browser' })
assert.match(ambiguity, /ambiguous/)
const enginePick = await measure('resolve version by engines.dsh', 'plugin_resolve', { target: 'dsh-builtin-browser' })
assert.match(enginePick, /0\.4\.\d+/)
const peerPick = await measure('resolve version across peer lines', 'plugin_resolve', { target: 'dsh-better-sidebar' })
assert.match(peerPick, /0\.26\.1/)
assert.match(peerPick, /0\.28\.0/)
await measure('resolve GitHub source plan', 'plugin_resolve', {
  target: 'github:omdsh-dev/dsh-browser#path:/packages/browser/bridge-browser',
})
const install = await measure('install orchestration + verification', 'plugin_install', { target: 'dsh-better-sidebar' })
assert.match(install, /install: applied/)
assert.match(install, /fiberPhase=active/)
assert.equal(installCalls.length, 1)
await measure('status inventory', 'plugin_status', {})

// --- report -----------------------------------------------------------------
const pad = (value, width) => String(value).padStart(width)
console.log('\nplugin path measurements')
console.log('task'.padEnd(40), pad('ms', 7), pad('net', 5), pad('chars', 7))
for (const row of results) {
  console.log(row.label.padEnd(40), pad(row.ms, 7), pad(row.fetches, 5), pad(row.chars, 7))
}
const totalMs = results.reduce((sum, row) => sum + row.ms, 0)
const totalFetches = results.reduce((sum, row) => sum + row.fetches, 0)
const totalChars = results.reduce((sum, row) => sum + row.chars, 0)
console.log('\ntotal'.padEnd(40), pad(Math.round(totalMs), 7), pad(totalFetches, 5), pad(totalChars, 7))
console.log(`\n${results.length} tool calls, ${Math.round(totalMs / 1000)}s wall clock, ${totalFetches} network requests, ${(totalChars / 1024).toFixed(1)} KiB of model-facing text`)
