/**
 * Offline checks for the pieces that must be right before anything installs:
 * the semver subset, catalog normalization/search, GitHub spec parsing, and the
 * version-selection rule that keeps a plugin on the DSH-compatible line.
 *
 * Run with: node test/selftest.mjs
 */

import assert from 'node:assert/strict'
import { normalizeCatalog, searchCatalog } from '../logic/catalog.js'
import { chooseCompatibleVersion, parseGithubSpec, parseNpmTarget } from '../logic/resolve.js'
import { decideRestart, tail } from '../logic/install.js'
import { satisfies, compareVersions } from '../logic/semver.js'

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${label}: ${error.message}`)
  }
}

// --- semver ---------------------------------------------------------------
check('exact equals itself', () => assert.equal(satisfies('0.2.0-rc.2', '0.2.0-rc.2'), true))
check('caret accepts its own prerelease line', () => assert.equal(satisfies('0.2.0-rc.2', '^0.2.0-rc.2'), true))
check('caret across minor rejects older host', () => assert.equal(satisfies('0.2.0-rc.2', '^0.2.1-rc.1'), false))
check('caret across major rejects', () => assert.equal(satisfies('0.2.0-rc.2', '^0.1.7-rc.1'), false))
check('comparator pair accepts rc host', () => assert.equal(satisfies('0.2.0-rc.2', '>=0.1.1-rc.2 <0.3.0'), true))
check('comparator pair rejects too-old host', () => assert.equal(satisfies('0.2.0-rc.2', '>=0.2.1-rc.1 <0.3.0'), false))
check('tilde patch line', () => {
  assert.equal(satisfies('4.0.5', '~4.0.4'), true)
  assert.equal(satisfies('4.1.0', '~4.0.4'), false)
})
check('union of lines', () => {
  assert.equal(satisfies('0.2.0-rc.2', '^0.1.0-rc.7 || ^0.1.1-rc.2 || ^0.2.0-rc.1'), true)
  assert.equal(satisfies('0.2.0-rc.2', '^0.1.0-rc.7 || ^0.1.2-alpha.2'), false)
})
check('partial ranges', () => {
  assert.equal(satisfies('1.4.0', '1'), true)
  assert.equal(satisfies('2.0.0', '1'), false)
  assert.equal(satisfies('1.2.9', '1.2'), true)
  assert.equal(satisfies('1.3.0', '1.2'), false)
})
check('versions sort with prerelease', () => {
  assert.equal(compareVersions('0.28.0', '0.26.1') > 0, true)
  assert.equal(compareVersions('0.2.0-rc.2', '0.2.0') < 0, true)
  assert.equal(compareVersions('0.2.0-rc.2', '0.2.0-rc.1') > 0, true)
})

// --- version selection ----------------------------------------------------
const doc = {
  versions: {
    '0.28.0': { peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.1-rc.1' } },
    '0.26.1': {
      peerDependencies: {
        '@deepseek-ai/dsh-agent': '^0.2.0-rc.2',
        '@huanlin/dsh-plugin-better-locale': '^0.1.0',
      },
      peerDependenciesMeta: { '@huanlin/dsh-plugin-better-locale': { optional: true } },
    },
    '0.22.1': { peerDependencies: { '@deepseek-ai/dsh-agent': '^0.1.7-rc.1' } },
  },
  tags: { latest: '0.28.0' },
}
check('picks newest DSH-compatible version', () => {
  const chosen = chooseCompatibleVersion(doc, '0.2.0-rc.2')
  assert.equal(chosen.version, '0.26.1')
  assert.match(chosen.rejected.map((item) => item.version).join(','), /0\.28\.0/)
})
check('engines.dsh is enforced', () => {
  const engineDoc = {
    versions: {
      '2.0.0': { engines: { dsh: '>=0.3.0' } },
      '1.0.0': { engines: { dsh: '>=0.1.1-rc.2 <0.3.0' } },
    },
    tags: {},
  }
  assert.equal(chooseCompatibleVersion(engineDoc, '0.2.0-rc.2').version, '1.0.0')
})
check('engines.dsh decides alone when peers disagree', () => {
  // The host's app-boot rule: an own engines.dsh range wins, peers are ignored.
  const conflict = {
    versions: {
      '1.0.0': {
        engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
        peerDependencies: { '@deepseek-ai/dsh-agent': '^0.3.0' },
      },
    },
    tags: { latest: '1.0.0' },
  }
  assert.equal(chooseCompatibleVersion(conflict, '0.2.1-rc.2').version, '1.0.0')
})
check('engines.dsh vetoes an otherwise-compatible peer line', () => {
  const veto = {
    versions: {
      '2.0.0': {
        engines: { dsh: '>=0.3.0' },
        peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.0-rc.2' },
      },
      '1.0.0': { peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.0-rc.2' } },
    },
    tags: {},
  }
  const chosen = chooseCompatibleVersion(veto, '0.2.1-rc.2')
  assert.equal(chosen.version, '1.0.0')
  assert.match(chosen.rejected.map((item) => item.version).join(','), /2\.0\.0/)
})
check('peer line still gates versions without engines.dsh', () => {
  const peerOnly = {
    versions: { '3.0.0': { peerDependencies: { '@deepseek-ai/dsh-agent': '^0.3.0' } } },
    tags: { latest: '3.0.0' },
  }
  assert.equal(chooseCompatibleVersion(peerOnly, '0.2.1-rc.2').version, null)
})
check('optional dsh peers still gate the version like the host', () => {
  // The host precheck never reads peerDependenciesMeta, so an optional dsh peer
  // whose range rejects the runtime makes the version incompatible anyway.
  const optionalPeer = {
    versions: {
      '1.0.0': {
        peerDependencies: { '@deepseek-ai/dsh-agent': '^0.3.0' },
        peerDependenciesMeta: { '@deepseek-ai/dsh-agent': { optional: true } },
      },
    },
    tags: { latest: '1.0.0' },
  }
  assert.equal(chooseCompatibleVersion(optionalPeer, '0.2.1-rc.2').version, null)
})
check('workspace peer ranges mean the running host', () => {
  const workspacePeer = {
    versions: { '1.0.0': { peerDependencies: { '@deepseek-ai/dsh-tools': 'workspace:*' } } },
    tags: { latest: '1.0.0' },
  }
  assert.equal(chooseCompatibleVersion(workspacePeer, '0.2.1-rc.2').version, '1.0.0')
})
check('empty engines.dsh is unmet', () => {
  const emptyEngine = {
    versions: {
      '1.0.0': {
        engines: { dsh: '' },
        peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.0-rc.2' },
      },
    },
    tags: { latest: '1.0.0' },
  }
  assert.equal(chooseCompatibleVersion(emptyEngine, '0.2.1-rc.2').version, null)
})

check('sibling @deepseek-ai/* packages are not runtime constraints', () => {
  const siblingDoc = {
    versions: {
      '0.4.13': {
        peerDependencies: {
          '@deepseek-ai/cordis': '^4.0.1',
          '@deepseek-ai/schemastery': '^3.18.1',
          '@deepseek-ai/dsh-tools': '>=0.1.1-rc.2 <0.3.0',
        },
      },
    },
    tags: { latest: '0.4.13' },
  }
  assert.equal(chooseCompatibleVersion(siblingDoc, '0.2.0-rc.2').version, '0.4.13')
})

// --- target parsing -------------------------------------------------------
check('npm target split', () => {
  assert.deepEqual(parseNpmTarget('dsh-better-sidebar'), { name: 'dsh-better-sidebar', version: null })
  assert.deepEqual(parseNpmTarget('dsh-better-sidebar@0.26.1'), { name: 'dsh-better-sidebar', version: '0.26.1' })
  assert.deepEqual(parseNpmTarget('@anweat/dsh-browser@0.2.1'), { name: '@anweat/dsh-browser', version: '0.2.1' })
})
check('github spec split', () => {
  const gh = parseGithubSpec('github:omdsh-dev/dsh-browser#path:/packages/browser/bridge-browser')
  assert.equal(gh.repo, 'omdsh-dev/dsh-browser')
  assert.equal(gh.subpath, 'packages/browser/bridge-browser')
  assert.equal(parseGithubSpec('github:owner/repo#v1.2.3').ref, 'v1.2.3')
})

// --- catalog search -------------------------------------------------------
const catalog = normalizeCatalog([
  { name: 'dsh-browser', owner: 'omdsh-dev', url: 'https://github.com/omdsh-dev/dsh-browser', npm: null, stars: 832, install: 'dsh plugin --profile web add github:omdsh-dev/dsh-browser#path:/packages/browser/bridge-browser', description: { en: 'Chrome sidebar extension' } },
  { name: 'dsh-browser', owner: 'wqty123', url: 'https://github.com/wqty123/dsh-browser', npm: 'dsh-builtin-browser', stars: 117, install: 'dsh plugin --profile web add dsh-builtin-browser', description: { en: 'Shared real browser' } },
  { name: 'DSH-better-sidebar', owner: 'omdsh-dev', url: 'https://github.com/omdsh-dev/DSH-better-sidebar', npm: 'dsh-better-sidebar', stars: 4214, install: 'dsh plugin --profile web add dsh-better-sidebar', description: { en: 'Sidebar workbench' } },
])
check('search keeps same-name ambiguity visible', () => {
  const { matches, ambiguous } = searchCatalog(catalog, 'dsh-browser', { limit: 10 })
  assert.equal(ambiguous, true)
  assert.equal(matches.length, 2)
})
check('exact npm name ranks first', () => {
  const { matches } = searchCatalog(catalog, 'dsh-better-sidebar', { limit: 5 })
  assert.equal(matches[0].entry.npm, 'dsh-better-sidebar')
})
check('installed marker applies', () => {
  const { matches } = searchCatalog(catalog, 'dsh-better-sidebar', { limit: 5, installed: new Set(['dsh-better-sidebar']) })
  assert.equal(matches[0].installed, true)
})

// --- diagnostic tail ------------------------------------------------------
check('tail keeps short text untouched', () => {
  assert.equal(tail('done in 1.5s', 700), 'done in 1.5s')
})
check('tail trims surrounding whitespace', () => {
  assert.equal(tail('  padded  ', 100), 'padded')
})
check('tail returns the last characters instead of the literal template', () => {
  const output = `${'x'.repeat(800)}\n[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: ssh2@1.17.0`
  const rendered = tail(output, 100)
  assert.equal(rendered.length, 101)
  assert.ok(rendered.startsWith('…'))
  assert.match(rendered, /ERR_PNPM_IGNORED_BUILDS/)
  assert.doesNotMatch(rendered, /\{flat\.slice/)
})

// --- restart decision -----------------------------------------------------
const runtime = (version, hash, extra = {}) => ({ version, hash, clientHash: hash, hasClient: false, ...extra })
const noBundles = { bundlesBefore: ['dsh-plugin-resolver'], bundlesAfter: ['dsh-plugin-resolver'] }

check('restart: no-op install needs no restart', () => {
  const decision = decideRestart({ before: runtime('1.0.0', 'a'), after: runtime('1.0.0', 'a'), ...noBundles, managerApplication: 'restart-required' })
  assert.equal(decision.required, false)
  assert.match(decision.reason, /unchanged/)
})
check('restart: version-only bump needs no restart', () => {
  const decision = decideRestart({ before: runtime('1.0.0', 'a'), after: runtime('1.0.1', 'a'), ...noBundles, managerApplication: 'restart-required' })
  assert.equal(decision.required, false)
  assert.equal(decision.versionChanged, true)
})
check('restart: runtime code change needs restart', () => {
  const decision = decideRestart({ before: runtime('1.0.0', 'a'), after: runtime('1.0.1', 'b'), ...noBundles, managerApplication: 'restart-required' })
  assert.equal(decision.required, true)
  assert.equal(decision.codeChanged, true)
})
check('restart: added bundle applied in place needs no restart', () => {
  const decision = decideRestart({ before: null, after: runtime('1.0.0', 'a'), bundlesBefore: ['dsh-plugin-resolver'], bundlesAfter: ['dsh-plugin-resolver', 'new-bundle'], managerApplication: 'applied' })
  assert.equal(decision.required, false)
  assert.equal(decision.bundleChanged, true)
  assert.match(decision.reason, /applied the bundle set change in place/)
})
check('restart: added bundle with a client half asks for a GUI refresh', () => {
  const decision = decideRestart({ before: null, after: runtime('1.0.0', 'a', { hasClient: true, clientHash: 'a' }), bundlesBefore: ['dsh-plugin-resolver'], bundlesAfter: ['dsh-plugin-resolver', 'new-bundle'], managerApplication: 'applied' })
  assert.equal(decision.required, false)
  assert.equal(decision.clientChanged, true)
})
check('restart: added bundle the manager could not apply needs restart', () => {
  const decision = decideRestart({ before: null, after: runtime('1.0.0', 'a'), bundlesBefore: ['dsh-plugin-resolver'], bundlesAfter: ['dsh-plugin-resolver', 'new-bundle'], managerApplication: 'restart-required' })
  assert.equal(decision.required, true)
  assert.match(decision.reason, /bundle set changed/)
})
check('restart: client-half change needs restart', () => {
  const decision = decideRestart({ before: runtime('1.0.0', 'a', { hasClient: true, clientHash: 'x' }), after: runtime('1.0.1', 'b', { hasClient: true, clientHash: 'y' }), ...noBundles, managerApplication: 'restart-required' })
  assert.equal(decision.required, true)
  assert.equal(decision.clientChanged, true)
})
check('restart: manager applied in place needs no restart', () => {
  const decision = decideRestart({ before: runtime('1.0.0', 'a'), after: runtime('1.0.1', 'b'), ...noBundles, managerApplication: 'applied' })
  assert.equal(decision.required, false)
  assert.match(decision.reason, /applied/)
})

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')

