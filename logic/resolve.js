// Reloadable module: local dependencies carry this module's `?v=` query.
const __v = new URL(import.meta.url).searchParams.get('v') ?? ''
const __q = (name) => `./${name}${__v === '' ? '' : `?v=${encodeURIComponent(__v)}`}`
const { baseName, githubSpecOf, normalizeCatalog, repoSlugOf, searchCatalog } = await import(__q('catalog.js'))
const { compareVersions, satisfies, sortVersionsDesc, parseVersion } = await import(__q('semver.js'))
const { fetchJson } = await import(__q('util.js'))
/**
 * Resolution: what a target names, which concrete version is DSH-compatible,
 * which registry to ask, and which install path applies.
 *
 * This is the decision layer the tools call before any mutation. It never
 * touches the profile beyond reading the manager's own inventory.
 *
 * @module dsh-plugin-resolver/lib/resolve
 */


/** A package name, optionally with an explicit version. */
const NPM_TARGET_RE = /^(@[^/@\s]+\/[^@\s]+|[^@/\s#]+)(?:@([^\s]+))?$/

/** Clear hints that the target is already a concrete install spec. */
const EXPLICIT_SPEC_RE = /^(github:|git\+|file:|link:|https?:\/\/|\.{0,2}[\\/])/i

/**
 * Read the running DSH core version from the manager's own bundle inventory.
 *
 * @param {any} manager the `pluginManager` service
 * @returns {Promise<string | null>}
 */
export async function runtimeVersion(manager) {
  try {
    const bundles = await manager.listBundles()
    const preferred = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh']
    for (const name of preferred) {
      const hit = bundles.find((bundle) => bundle.name === name && typeof bundle.version === 'string')
      if (hit) return hit.version
    }
    return null
  } catch {
    return null
  }
}

/**
 * Pick the registry asked first: the Host's own probe when mounted, else the
 * manager's configured registry, else null (pnpm's own configuration).
 *
 * @param {any} ctx cordis context
 * @param {any} manager
 * @returns {Promise<string | null>}
 */
export async function chooseRegistry(ctx, manager) {
  const probe = ctx.get('pluginRegistryProbe')
  if (probe && typeof probe.fastest === 'function') {
    try {
      const fastest = await probe.fastest()
      if (typeof fastest === 'string' && fastest !== '') return fastest
    } catch {
      // fall through to the configured registry
    }
  }
  try {
    const registries = await manager.registries()
    if (registries?.resolved) return registries.resolved
    if (typeof registries?.registry === 'string') return registries.registry
  } catch {
    // fall through
  }
  return null
}

/** A concrete base URL for registry HTTP reads. */
export function registryBase(registry) {
  if (typeof registry === 'string' && /^https?:\/\//i.test(registry)) return registry.replace(/\/+$/, '')
  return 'https://registry.npmjs.org'
}

/** Encode a scoped package name for a registry path. */
export function encodePackageName(name) {
  return name.startsWith('@') ? name.replace('/', '%2f') : name
}

/**
 * Fetch a package document from a registry.
 *
 * @param {string} name
 * @param {string} registry
 * @returns {Promise<{name: string, versions: Record<string, any>, tags: Record<string, string>}>}
 */
export async function npmPackage(name, registry) {
  const base = registryBase(registry)
  const doc = await fetchJson(`${base}/${encodePackageName(name)}`, { timeoutMs: 30_000 })
  if (!doc || typeof doc !== 'object' || typeof doc.versions !== 'object') {
    throw new Error(`registry returned no version document for ${name}`)
  }
  return { name, versions: doc.versions ?? {}, tags: doc['dist-tags'] ?? {} }
}

/**
 * Choose the newest published version that accepts the running DSH version.
 *
 * Only non-optional `@deepseek-ai/*` peers and an `engines.dsh` range are
 * treated as runtime constraints: a plugin declares its DSH support line there
 * independently of what a caret over a `0.x` prerelease happens to permit.
 *
 * @param {{versions: Record<string, any>, tags: Record<string, string>}} doc
 * @param {string | null} runtime
 * @returns {{version: string | null, reason: string, rejected: Array<{version: string, reason: string}>}}
 */
export function chooseCompatibleVersion(doc, runtime) {
  const all = Object.keys(doc.versions).filter((version) => parseVersion(version) !== null)
  const rejected = []
  if (all.length === 0) return { version: null, reason: 'no published version', rejected }
  const ordered = sortVersionsDesc(all)
  if (runtime === null) {
    const latest = doc.tags.latest ?? ordered[0]
    return { version: latest, reason: 'DSH runtime version unknown; trusting the registry latest tag', rejected }
  }
  for (const version of ordered) {
    const manifest = doc.versions[version] ?? {}
    if (manifest.deprecated) {
      if (rejected.length < 4) rejected.push({ version, reason: 'deprecated' })
      continue
    }
    const constraint = peerConstraint(manifest, runtime)
    if (constraint.ok) {
      return {
        version,
        reason: `newest of ${all.length} published versions whose DSH peer range accepts ${runtime}`,
        rejected,
      }
    }
    if (rejected.length < 4) rejected.push({ version, reason: constraint.reason })
  }
  return { version: null, reason: `no published version accepts DSH ${runtime}`, rejected }
}

/**
 * Check one published version's runtime constraints against the running DSH.
 *
 * Only the Host's own `@deepseek-ai/dsh*` packages share the runtime version
 * line. Sibling libraries such as `@deepseek-ai/cordis` or
 * `@deepseek-ai/schemastery` have their own version numbers and are therefore
 * not runtime constraints.
 *
 * @param {any} manifest
 * @param {string} runtime
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function peerConstraint(manifest, runtime) {
  const peers = manifest.peerDependencies ?? {}
  const optional = manifest.peerDependenciesMeta ?? {}
  const checked = []
  for (const [name, range] of Object.entries(peers)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    if (optional[name]?.optional === true) continue
    if (typeof range !== 'string' || range.trim() === '') continue
    checked.push(`${name}@${range}`)
    if (!satisfies(runtime, range)) {
      return { ok: false, reason: `${name} needs ${range}, host is ${runtime}` }
    }
  }
  const engine = manifest.engines?.dsh
  if (typeof engine === 'string' && engine !== '') {
    checked.push(`engines.dsh ${engine}`)
    if (!satisfies(runtime, engine)) return { ok: false, reason: `engines.dsh wants ${engine}, host is ${runtime}` }
  }
  return { ok: true, reason: checked.length > 0 ? checked.join('; ') : 'no DSH constraint' }
}

/**
 * Split `name@version`, leaving a scoped package intact.
 *
 * @param {string} target
 * @returns {{name: string, version: string | null} | null}
 */
export function parseNpmTarget(target) {
  const match = NPM_TARGET_RE.exec(target.trim())
  if (!match) return null
  return { name: match[1], version: match[2] ?? null }
}

/**
 * Parse a GitHub shorthand into its repository, revision and subpath.
 *
 * @param {string} spec
 * @returns {{repo: string, owner: string, name: string, ref: string | null, subpath: string | null} | null}
 */
export function parseGithubSpec(spec) {
  const match = /^github:([^/\s#]+)\/([^/\s#]+)(?:#([^\s]*))?$/i.exec(spec.trim())
  if (!match) return null
  let ref = null
  let subpath = null
  for (const selector of (match[3] ?? '').split('&')) {
    if (selector === '') continue
    const pathMatch = /^path:\/?(.+)$/.exec(selector)
    if (pathMatch) {
      subpath = pathMatch[1].replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      continue
    }
    if (/^[0-9a-f]{40}$/i.test(selector)) continue
    if (selector.startsWith('semver:')) {
      ref = null
      continue
    }
    if (selector.trim() !== '') ref = selector.trim()
  }
  return { repo: `${match[1]}/${match[2]}`, owner: match[1], name: match[2], ref, subpath }
}

/**
 * Resolve one target into an actionable plan without mutating anything.
 *
 * @param {any} ctx
 * @param {any} manager
 * @param {string} target user input: catalog name, npm name, name@version, or a spec
 * @param {{owner?: string, version?: string, registry?: string, catalog?: CatalogEntry[]}} [options]
 * @returns {Promise<Resolution>}
 */
export async function resolveTarget(ctx, manager, target, options = {}) {
  const trimmed = String(target ?? '').trim()
  if (trimmed === '') throw new Error('empty target')
  const registry = options.registry ?? (await chooseRegistry(ctx, manager))
  const runtime = await runtimeVersion(manager)
  const notes = []

  if (EXPLICIT_SPEC_RE.test(trimmed)) {
    const gh = parseGithubSpec(trimmed)
    if (gh) return await resolveGithub(manager, gh, { registry, runtime, notes, target: trimmed })
    return {
      kind: 'spec',
      spec: trimmed,
      name: null,
      version: null,
      registry,
      runtime,
      notes: ['installed verbatim through the profile plugin manager'],
    }
  }

  const parsed = parseNpmTarget(trimmed)
  if (!parsed) throw new Error(`cannot parse "${trimmed}" as a package name or spec`)
  const explicitVersion = options.version ?? parsed.version
  let name = parsed.name
  let catalogEntry = null

  const catalog = options.catalog ?? []
  if (catalog.length > 0) {
    const { matches } = searchCatalog(catalog, name, { limit: 12 })
    const exact = matches.filter(({ entry }) => baseName(entry).toLowerCase() === name.toLowerCase())
    const pool = exact.length > 0 ? exact.map(({ entry }) => entry) : []
    if (pool.length > 0) {
      let chosen = pool
      if (options.owner) {
        const wanted = options.owner.toLowerCase()
        chosen = pool.filter((entry) => entry.owner.toLowerCase() === wanted)
        if (chosen.length === 0) {
          throw new Error(
            `catalog has no "${name}" by owner "${options.owner}". Owners: ${pool
              .map((entry) => entry.owner || 'unknown')
              .join(', ')}`,
          )
        }
      }
      if (chosen.length > 1) {
        return {
          kind: 'ambiguous',
          name,
          registry,
          runtime,
          candidates: chosen.map((entry) => ({
            name: baseName(entry),
            owner: entry.owner,
            stars: entry.stars,
            npm: entry.npm,
            install: entry.install,
            url: entry.url,
            description: entry.description,
          })),
          notes: ['several catalog entries share this name; re-run with owner or a full spec'],
        }
      }
      catalogEntry = chosen[0]
      if (catalogEntry.npm) name = catalogEntry.npm
      else {
        const spec = githubSpecOf(catalogEntry)
        if (spec) {
          const gh = parseGithubSpec(spec)
          if (gh) {
            notes.push(`catalog entry ${catalogEntry.name} is GitHub-only (no npm package)`)
            return await resolveGithub(manager, gh, { registry, runtime, notes, target: spec, catalogEntry })
          }
        }
        notes.push(`catalog entry ${catalogEntry.name} has no usable source; falling back to the npm name`)
      }
    }
  }

  if (explicitVersion) {
    return {
      kind: 'npm',
      name,
      spec: `${name}@${explicitVersion}`,
      version: explicitVersion,
      registry,
      runtime,
      catalogEntry,
      notes: [...notes, 'explicit version requested; compatibility not checked'],
    }
  }

  let doc = null
  try {
    doc = await npmPackage(name, registry)
  } catch (error) {
    notes.push(`registry lookup failed (${error.message}); install will resolve the version itself`)
    return { kind: 'npm', name, spec: name, version: null, registry, runtime, catalogEntry, notes }
  }
  const chosen = chooseCompatibleVersion(doc, runtime)
  if (chosen.version === null) {
    throw new Error(
      `${name} has no version compatible with DSH ${runtime ?? 'unknown'}. ` +
        `Nearest rejects: ${chosen.rejected.map((item) => `${item.version} (${item.reason})`).join('; ') || 'none'}`,
    )
  }
  if (chosen.rejected.length > 0) {
    notes.push(
      `skipped newer incompatible versions: ${chosen.rejected.map((item) => `${item.version} (${item.reason})`).join('; ')}`,
    )
  }
  return {
    kind: 'npm',
    name,
    spec: `${name}@${chosen.version}`,
    version: chosen.version,
    latest: doc.tags?.latest ?? null,
    registry,
    runtime,
    catalogEntry,
    notes: [...notes, chosen.reason],
    rejected: chosen.rejected,
  }
}

/**
 * Plan a GitHub-source install.
 *
 * @param {any} manager
 * @param {{repo: string, owner: string, name: string, ref: string | null, subpath: string | null}} gh
 * @param {{registry: string | null, runtime: string | null, notes: string[], target: string, catalogEntry?: any}} context
 * @returns {Promise<Resolution>}
 */
async function resolveGithub(manager, gh, context) {
  const slug = gh.repo
  const label = gh.subpath ? `${slug}/${gh.subpath}` : slug
  return {
    kind: 'github',
    repo: slug,
    owner: gh.owner,
    name: gh.name,
    ref: gh.ref,
    subpath: gh.subpath,
    spec: context.target,
    version: null,
    registry: context.registry,
    runtime: context.runtime,
    catalogEntry: context.catalogEntry ?? null,
    notes: [
      ...context.notes,
      `GitHub source build: ${label}${gh.ref ? ` @ ${gh.ref}` : ''}`,
      'source checkout is built locally (pnpm install + build) and then linked into the profile',
    ],
    label,
  }
}

/**
 * @typedef {object} Resolution
 * @property {'npm' | 'github' | 'spec' | 'ambiguous'} kind
 * @property {string} spec
 * @property {string | null} name
 * @property {string | null} version
 * @property {string | null} registry
 * @property {string | null} runtime
 * @property {string[]} notes
 * @property {Array<{name: string, owner: string, stars: number, npm: string | null, install: string | null, url: string, description: string}>} [candidates]
 * @property {Array<{version: string, reason: string}>} [rejected]
 * @property {any} [catalogEntry]
 * @property {string} [repo]
 * @property {string | null} [ref]
 * @property {string | null} [subpath]
 * @property {string} [latest]
 */

export { normalizeCatalog, compareVersions, repoSlugOf, githubSpecOf }

