/**
 * Reloadable logic entry: every tool body lives here, behind one cache-busted
 * import. The host shell asks for this module with `?v=<logic mtime>` on each
 * call, so editing any file under `logic/` takes effect on the next tool call
 * without restarting the host.
 *
 * Nothing in here touches the loader or the tool registry; it receives the
 * profile's `pluginManager` and a Cordis context and returns plain text.
 *
 * @module dsh-plugin-resolver/logic/api
 */

// Local dependencies carry this module's own `?v=` query, so one cache-busted
// import of `api.js` reloads catalog/resolve/install/util together.
const __v = new URL(import.meta.url).searchParams.get('v') ?? ''
const __q = (name) => `./${name}${__v === '' ? '' : `?v=${encodeURIComponent(__v)}`}`
const { baseName, loadCatalog, searchCatalog } = await import(__q('catalog.js'))
const { installGithubSource, installRegistry, verifyInstall } = await import(__q('install.js'))
const { resolveTarget } = await import(__q('resolve.js'))
const { oneLine, stars } = await import(__q('util.js'))

/** Catalog load honoring the `refresh` flag and config overrides. */
async function catalogFor(options, refresh) {
  try {
    const combined = { ...options }
    if (refresh) return await loadCatalog(combined, { force: true })
    return await loadCatalog(combined)
  } catch (error) {
    return { entries: [], fetchedAt: 0, fromCache: false, source: 'unavailable', error: error?.message ?? String(error) }
  }
}

/** Bundle names already installed in this profile. */
async function installedNames(manager) {
  const set = new Set()
  if (!manager) return set
  try {
    const bundles = await manager.listBundles()
    for (const bundle of bundles) {
      if (bundle?.installed && typeof bundle.name === 'string') set.add(bundle.name)
    }
  } catch {
    // inventory is best-effort
  }
  return set
}

/**
 * `plugin_search`: rank catalog entries and keep same-name ambiguity visible.
 *
 * @param {any} ctx
 * @param {any} manager
 * @param {Record<string, unknown>} options
 * @param {any} args
 * @returns {Promise<{text: string}>}
 */
export async function pluginSearch(ctx, manager, options, args) {
  const query = String(args?.query ?? '').trim()
  if (query === '') return { text: 'plugin_search needs a non-empty query.' }
  const installed = await installedNames(manager)
  const catalog = await catalogFor(options, args?.refresh === true)
  if (catalog.entries.length === 0) {
    return { text: `Catalog is unavailable right now: ${catalog.error ?? 'empty catalog'}` }
  }
  const { matches, ambiguous } = searchCatalog(catalog.entries, query, {
    limit: Number(args?.limit) || 8,
    installed,
  })
  if (matches.length === 0) {
    return { text: `No catalog entry matches "${query}" (${catalog.entries.length} entries, ${catalog.fromCache ? 'cached' : 'fresh'}).` }
  }
  const lines = [
    `${matches.length} match(es) for "${query}" — catalog ${catalog.entries.length} entries, ${catalog.fromCache ? 'cached' : `fresh from ${catalog.source}`}:`,
    '',
  ]
  matches.forEach(({ entry, installed: isInstalled }, index) => {
    lines.push(`${index + 1}. ${entry.name}  ★${stars(entry.stars)}  owner=${entry.owner || '?'}${isInstalled ? '  [installed]' : ''}`)
    if (entry.npm) lines.push(`   npm: ${entry.npm}${entry.version ? `@${entry.version}` : ''}`)
    else lines.push('   npm: (not published — GitHub source)')
    if (entry.install) lines.push(`   install: ${entry.install}`)
    if (entry.description) lines.push(`   ${oneLine(entry.description, 150)}`)
  })
  if (ambiguous) {
    lines.push('', 'Same name has several owners. Disambiguate with owner or a full spec, e.g. owner="wqty123".')
  }
  return { text: lines.join('\n') }
}

/**
 * `plugin_resolve`: produce the install plan without mutating anything.
 */
export async function pluginResolve(ctx, manager, options, args) {
  if (!manager) return { text: 'The pluginManager service is not mounted in this profile; resolve is unavailable.' }
  const catalog = await catalogFor(options, args?.refresh === true)
  const plan = await resolveTarget(ctx, manager, String(args?.target ?? ''), {
    owner: typeof args?.owner === 'string' ? args.owner : undefined,
    version: typeof args?.version === 'string' ? args.version : undefined,
    registry: typeof args?.registry === 'string' && args.registry !== '' ? args.registry : options.registry,
    catalog: catalog.entries,
  })
  return { text: formatPlan(plan, 'resolve') }
}

/**
 * `plugin_install`: resolve, install through the manager, verify, and report
 * whether a refresh or restart is needed.
 */
export async function pluginInstall(ctx, manager, options, args) {
  if (!manager) return { text: 'The pluginManager service is not mounted in this profile; install is unavailable.' }
  try {
    const catalog = await catalogFor(options, args?.refresh === true)
    const plan = await resolveTarget(ctx, manager, String(args?.target ?? ''), {
      owner: typeof args?.owner === 'string' ? args.owner : undefined,
      version: typeof args?.version === 'string' ? args.version : undefined,
      registry: typeof args?.registry === 'string' && args.registry !== '' ? args.registry : options.registry,
      catalog: catalog.entries,
    })
    if (plan.kind === 'ambiguous') return { text: formatPlan(plan, 'install') }

    const lines = [formatPlan(plan, 'install'), '']
    const logLines = []
    let packageName = plan.name
    let steps = []
    let application = 'unknown'

    if (plan.kind === 'github') {
      const result = await installGithubSource(manager, plan, {
        githubProxy: options.githubProxy,
        skipBuild: args?.skipBuild === true,
        log: (line) => {
          logLines.push(line)
          if (logLines.length > 12) logLines.shift()
        },
      })
      packageName = result.packageName
      steps = result.steps
      application = result.summary.application
      lines.push(`install: ${result.summary.application} (${result.summary.stage})`)
      if (result.summary.error) lines.push(`error: ${result.summary.error}`)
      if (steps.length > 0) lines.push(`steps: ${steps.join(' → ')}`)
    } else {
      const { summary } = await installRegistry(manager, plan)
      application = summary.application
      if (packageName === null && summary.bundle) packageName = summary.bundle
      lines.push(`install: ${summary.application} (${summary.stage})`)
      if (summary.error) lines.push(`error: ${summary.error}`)
      if (summary.pendingBuilds.length > 0) {
        lines.push(`pending build scripts (needs approval): ${summary.pendingBuilds.join(', ')}`)
      }
    }

    if (packageName) {
      const health = await verifyInstall(ctx, manager, packageName)
      lines.push('', 'verification:')
      if (health.entry) {
        const phase = health.entry.fiberPhase ?? 'unknown'
        const flag = phase === 'active' ? 'OK' : phase === 'failed' ? 'FAILED' : phase
        lines.push(`- loader entry ${health.entry.entryId}: enabled=${health.entry.enabled} fiberPhase=${phase} [${flag}]`)
      } else {
        lines.push('- loader entry: not found — the host half may need a restart to mount')
      }
      if (health.bundle) {
        lines.push(`- bundle: ${health.bundle.name}@${health.bundle.version ?? '?'} enabled=${health.bundle.enabled}`)
      }
      lines.push(`- package: ${packageName}${health.hasClient ? ` (client half via ${health.clientSource})` : ' (host-only)'}`)
      const next = []
      if (application === 'restart-required') {
        next.push('restart DSH fully: replacing an already-mounted plugin cannot be hot-swapped safely')
      }
      if (health.entry?.fiberPhase === 'failed') next.push('host half failed to load; inspect the harness log for the error')
      if (health.hasClient && application !== 'restart-required') next.push('client half exists: refresh the GUI (Ctrl+R) to load it')
      if (health.entry?.fiberPhase === 'active' && !health.hasClient && application !== 'restart-required') {
        next.push('host-only: no GUI refresh required')
      }
      if (next.length > 0) lines.push('', `next: ${next.join('; ')}`)
    }
    if (logLines.length > 0) lines.push('', `build log (tail):\n  ${logLines.join('\n  ')}`)
    return { text: lines.join('\n') }
  } catch (error) {
    return { text: `plugin_install failed: ${error?.message ?? String(error)}` }
  }
}

/**
 * `plugin_status`: third-party bundles and their loader entries.
 */
export async function pluginStatus(ctx, manager, options, args) {
  if (!manager) return { text: 'The pluginManager service is not mounted in this profile; status is unavailable.' }
  const filter = String(args?.query ?? '').trim().toLowerCase()
  const lines = []
  try {
    const bundles = await manager.listBundles()
    const installed = bundles.filter((bundle) => bundle.installed && !String(bundle.name).startsWith('@deepseek-ai/'))
    lines.push(`installed third-party bundles: ${installed.length}`)
    for (const bundle of installed) {
      if (filter !== '' && !String(bundle.name).toLowerCase().includes(filter)) continue
      lines.push(`- ${bundle.name}@${bundle.version ?? '?'} enabled=${bundle.enabled} optional=${bundle.optional}`)
      const rows = Array.isArray(bundle.rows) ? bundle.rows.filter((row) => row.entryId) : []
      if (rows.length > 0) lines.push(`  rows: ${rows.map((row) => `${row.entryId}(${row.moduleName})`).join(', ')}`)
    }
  } catch (error) {
    lines.push(`bundle inventory failed: ${error.message}`)
  }
  try {
    const plugins = await manager.listPlugins()
    const thirdParty = plugins.filter((plugin) => {
      const name = String(plugin.moduleName ?? '')
      return name !== '' && !name.startsWith('@deepseek-ai/') && !name.startsWith('file:///')
    })
    lines.push('', `third-party loader entries: ${thirdParty.length}`)
    for (const plugin of thirdParty) {
      if (filter !== '' && !plugin.moduleName.toLowerCase().includes(filter)) continue
      lines.push(`- ${plugin.entryId}: ${plugin.moduleName} enabled=${plugin.enabled} fiberPhase=${plugin.fiberPhase ?? 'null'}`)
    }
  } catch (error) {
    lines.push(`plugin inventory failed: ${error.message}`)
  }
  return { text: lines.join('\n') }
}

/**
 * Render a resolution plan as compact text.
 *
 * @param {any} plan
 * @param {'resolve' | 'install'} mode
 * @returns {string}
 */
export function formatPlan(plan, mode) {
  if (plan.kind === 'ambiguous') {
    const lines = [`"${plan.name}" is ambiguous: ${plan.candidates.length} catalog entries share this name.`, '']
    plan.candidates.forEach((candidate, index) => {
      lines.push(
        `${index + 1}. owner=${candidate.owner || '?'}  ★${stars(candidate.stars)}  ${
          candidate.npm ? `npm: ${candidate.npm}` : 'npm: (GitHub source)'
        }`,
      )
      if (candidate.install) lines.push(`   install: ${candidate.install}`)
      if (candidate.description) lines.push(`   ${oneLine(candidate.description, 130)}`)
    })
    lines.push('', `Re-run ${mode === 'install' ? 'plugin_install' : 'plugin_resolve'} with owner="<owner>" or a full spec.`)
    return lines.join('\n')
  }
  const lines = []
  const runtime = plan.runtime ?? 'unknown'
  lines.push(`target kind: ${plan.kind}   running DSH: ${runtime}`)
  if (plan.name) lines.push(`package: ${plan.name}${plan.version ? `@${plan.version}` : ''}`)
  if (plan.spec) lines.push(`install spec: ${plan.spec}`)
  if (plan.registry) lines.push(`registry: ${plan.registry}`)
  else lines.push('registry: pnpm default (no first registry named)')
  if (plan.latest && plan.latest !== plan.version) lines.push(`latest published: ${plan.latest} (not used: incompatible or newer)`)
  if (plan.kind === 'github') {
    lines.push(`source: github.com/${plan.repo}${plan.ref ? ` @ ${plan.ref}` : ''}${plan.subpath ? ` (${plan.subpath})` : ''}`)
  }
  if (plan.catalogEntry) {
    lines.push(`catalog: ${plan.catalogEntry.name} by ${plan.catalogEntry.owner || '?'} ★${stars(plan.catalogEntry.stars)}`)
    if (plan.catalogEntry.description) lines.push(`about: ${oneLine(plan.catalogEntry.description, 160)}`)
  }
  if (Array.isArray(plan.rejected) && plan.rejected.length > 0) {
    lines.push('skipped versions:')
    for (const item of plan.rejected) lines.push(`- ${item.version}: ${item.reason}`)
  }
  if (Array.isArray(plan.notes) && plan.notes.length > 0) {
    lines.push('notes:')
    for (const note of plan.notes) lines.push(`- ${note}`)
  }
  if (mode === 'install') lines.push('', 'proceeding with install…')
  return lines.join('\n')
}

export { baseName }
