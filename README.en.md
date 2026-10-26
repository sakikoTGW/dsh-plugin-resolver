<p align="center">
  <img src="assets/banner.svg" alt="DSH Plugin Resolver — install the right plugin in one call" width="1280">
</p>

<p align="center">
  <a href="README.md">简体中文</a> | <strong>English</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-plugin-resolver"><img alt="npm" src="https://img.shields.io/npm/v/dsh-plugin-resolver?style=flat-square&color=4D6BFE&logo=npm&logoColor=white"></a>
  <a href="https://github.com/sakikoTGW/dsh-plugin-resolver/actions/workflows/test.yml"><img alt="test" src="https://img.shields.io/github/actions/workflow/status/sakikoTGW/dsh-plugin-resolver/test.yml?style=flat-square&label=test&color=2FBF71"></a>
  <img alt="39 checks" src="https://img.shields.io/badge/checks-39%20passing-2FBF71?style=flat-square">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-263146?style=flat-square"></a>
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-4D6BFE?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white">
</p>

# dsh-plugin-resolver

> **Install the right plugin in one call.**
>
> Search the catalog → disambiguate same-name plugins → pick a version the running DSH accepts → install (registry or GitHub source build) → verify the install.
>
> Measured on one ambiguous + one GitHub-only plugin: **~45 → 6 tool calls**, **20+ min → ~3 min**, **0 failed retries**.
>
> host-only plugin · 4 tools · pure ESM, no build step · DSH `>=0.2.0-rc.2 <0.3.0` · Node `>=20`

<p align="center">
  <img src="assets/demo.gif" alt="Terminal running npm test: 29 logic checks and 10 host-free harness checks pass" width="760">
</p>
<p align="center"><sub>Real output: all 39 checks from <code>npm test</code> pass (<a href="demo/demo.tape">VHS tape</a> to re-record)</sub></p>

## Contents

- [Why](#why)
- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Four tools](#four-tools)
- [Version selection](#version-selection)
- [Install paths and restarts](#install-paths-and-restarts)
- [Layout](#layout)
- [Results and evidence](#results-and-evidence)
- [Listings](#listings)
- [Tests and CI](#tests-and-ci)
- [Known limitations](#known-limitations)
- [Feedback and security](#feedback-and-security)
- [License](#license)

## Why

Installing two real plugins on one DSH install: `dsh-better-sidebar` (npm's `latest` is not guaranteed to accept the running core) and `dsh-browser` (six same-name owners, GitHub-only, needs a local build). When the install is delegated to an agent, the manual path looks like this:

| What happens on the manual path | Cost (measured on a real machine) |
|---|---|
| Pull the community catalog from GitHub Pages (6.4 MB) | **91 s**, and the model still has to read it |
| 287 same-name groups; `dsh-browser` alone has 6 owners | Guesswork; in **51 groups** the highest-star entry is GitHub-only while the same name also exists on npm |
| `latest` may not accept the running core (peer line or `engines.dsh` above the host) | The host's startup precheck **silently disables** it |
| Direct npmjs is slow | Two **90 s timeouts**; 13.4 s with a mirror |
| GitHub-only repos ship no build output | `main` points at a missing file — it installs and **never loads** |
| No idea whether it took effect | You still need to read back loader entries / the client boot table |

This plugin freezes those **decisions and checks** once; after that, each install is one tool call.

> It is not a replacement for the official Discover market: if you click through the UI, the market is already good enough. This plugin serves people who **delegate installs to an agent**.

## How it works

<p align="center">
  <img src="assets/flow.svg" alt="One tool call in five stages: search, resolve, install, verify, report" width="1200">
</p>
<p align="center"><sub>The two failure paths that must be reported honestly are in the diagram too: no compatible version, and installed but not mounted.</sub></p>

Only `plugin_install` writes to the environment; the other three are read-only. Ambiguous names, GitHub sources and unknown origins get a resolution plan first — the plugin never guesses for you.

## Quickstart

Install the resolver once (~10 s). From the next install on, the user only says "install xxx for me".

### Plugin market (recommended, GUI)

`Plugins → Experimental plugins → Open custom plugin market → Discover → Add index source`:

```text
https://sakikoTGW.github.io/dsh-plugin-resolver/market/index.json
```

Then install `dsh-plugin-resolver`.

### npm (published as `0.1.2`)

```sh
dsh plugin --profile <profile> add dsh-plugin-resolver
```

### GitHub source / tarball

```sh
# pin a commit
dsh plugin --profile <profile> add github:sakikoTGW/dsh-plugin-resolver#<commit>

# or pack locally
npm pack && dsh plugin --profile <profile> add ./dsh-plugin-resolver-0.1.2.tgz
```

Restart the host once. After that:

```text
"install dsh-browser"         → 6 same-name candidates, asks for owner=, never guesses
"install dsh-builtin-browser" → picks the version compatible with the running core
"install dsh-better-sidebar"  → latest is incompatible: degrades automatically and lists skipped versions
```

<p align="center">
  <img src="assets/demo-resolve.gif" alt="A real plugin_resolve call: resolving a compatible version from the catalog and registry" width="760">
</p>
<p align="center"><sub>Real call captured from a local harness (host 0.2.0-rc.2): one compatible version resolved from the real catalog and registry.</sub></p>

A real call looks like this (host 0.2.0-rc.2):

```text
$ plugin_resolve dsh-builtin-browser
target kind: npm   running DSH: 0.2.0-rc.2
package: dsh-builtin-browser@0.4.15
install spec: dsh-builtin-browser@0.4.15
registry: https://registry.npmmirror.com/
notes:
- newest of 41 published versions whose DSH peer range accepts 0.2.0-rc.2
```

An install call also carries verification and the restart decision:

```text
$ plugin_install dsh-better-sidebar
target kind: npm   running DSH: 0.2.1-rc.2
package: dsh-better-sidebar@0.28.0
install spec: dsh-better-sidebar@0.28.0
...
restart: not required — manager applied the change in place
```

## Four tools

| Tool | What it does | Writes to the environment |
|---|---|---|
| <img src="assets/icons/search.svg" width="18" alt=""> `plugin_search` | Search the catalog (npm carrier first), rank, and surface same-name ambiguity | read-only |
| <img src="assets/icons/resolve.svg" width="18" alt=""> `plugin_resolve` | Resolve without installing: catalog entry, compatible version, registry, whether a source build is needed | read-only |
| <img src="assets/icons/install.svg" width="18" alt=""> `plugin_install` | Full install: select version → install/build → verify → next-step hint | writes the profile |
| <img src="assets/icons/status.svg" width="18" alt=""> `plugin_status` | Inventory installed bundles, loader entries and fiber phase | read-only |

<p align="center">
  <img src="assets/tool-search.png" alt="Real plugin_search output: six same-name dsh-browser candidates, asks for owner=" width="980">
</p>
<p align="center"><sub>Real output (local harness, 2026-10-27): same-name ambiguity is never guessed — owner, stars, npm name and install command stay visible.</sub></p>

<p align="center">
  <img src="assets/tool-resolve.png" alt="Real plugin_resolve output: target kind, package, install spec, registry" width="900">
</p>
<p align="center"><sub>Real output: resolve only reads — it hands back a reviewable install plan first.</sub></p>

## Version selection

1. The **running version** is the version of `@deepseek-ai/dsh-base` inside `pluginManager.listBundles()`;
2. Walk versions from newest to oldest: non-optional **`@deepseek-ai/dsh*`** peers must accept the running version, and a declared **`engines.dsh`** must accept it too;
3. Libraries in the same namespace but on a different version line — `@deepseek-ai/cordis`, `@deepseek-ai/schemastery` — are **not** runtime constraints. Treating them as constraints once misjudged 4/8 packages as "no compatible version" (see [ABLATION](ABLATION.md));
4. Take the first version that passes; if none pass, list the rejection reasons of the closest versions. An explicit `version` skips resolution.

## Install paths and restarts

- **Registry packages**: `pluginManager.installBundle(name@resolved, { registry })`; profile, lockfile and activation lifecycle stay with the plugin manager;
- **GitHub-only**: check out to `$DSH_HOME/plugin-sources/<owner>__<repo>`, run `pnpm install` + `pnpm run build` when build output is missing and a build script is declared, then `installBundle('link:<pkgDir>')`; already-built checkouts are reused;
- **Explicit specs** (`github:` / `link:` / `file:` / `https:`): passed to the plugin manager as-is.

`plugin_install` no longer asks for a restart unconditionally. It compares the bundle set from `listBundles()` and runtime file hashes before and after (excluding README / docs / version numbers); for newly added bundles the manager's application result decides:

| Change | Result |
|---|---|
| No change / version-only / manager applied in place (including a new bundle via HMR recomposition) | `restart: not required` |
| Manager requested a restart (new bundle, runtime code change, client-half change) | `restart: required — <reason>` |
| New plugin with a client half | adds a "refresh the GUI" hint |

## Layout

<p align="center">
  <img src="assets/architecture.svg" alt="Stable shell and hot-reloadable logic, two layers" width="1200">
</p>
<p align="center"><sub>Shell changes need a restart; <code>logic/</code> changes land on the next tool call.</sub></p>

On every call, `host/register.js` computes the newest mtime under `logic/` and imports `./logic/api.js?v=<mtime>`; logic modules pass the same `?v=` to each other. Node caches ES modules by full URL, so:

- editing anything under `logic/` takes effect on the **next tool call** without a host restart (measured 3 ms; a restart costs 30–40 s)
- only changes to the tool-definition layer (`index.js` / `host/register.js`) need a restart

This is designed for a packaged runtime without HMR: the host cannot reach the Node-internal module loader that real HMR needs, but re-importing a module with a fresh query string works fine.

## Results and evidence

<p align="center">
  <img src="assets/benchmark.svg" alt="Benchmark: manual path versus resolver for catalog, registry, tool calls and end-to-end time" width="1200">
</p>
<p align="center"><sub>Two paths for the same job; numbers from <a href="BENCHMARK.md">BENCHMARK.md</a> and <a href="ABLATION.md">ABLATION.md</a>.</sub></p>

| Metric | Manual agent path | This plugin | Source |
|---|---|---|---|
| Tool calls (1 ambiguous + 1 GitHub-only) | ~45 | **~6** | [BENCHMARK](BENCHMARK.md) |
| End-to-end time | 20–25 min | **~3 min** (including unavoidable install/build) | [BENCHMARK](BENCHMARK.md) |
| Decision chain | Re-derived every time | **1.23 s (9 calls)** | [BENCHMARK](BENCHMARK.md) |
| Catalog fetch | 91.06 s / 6.4 MB | **0.94 s / 2 requests** | [BENCHMARK](BENCHMARK.md) |
| Install retries | two 90 s timeouts | **0** | session log |
| Post-install probes | 2 | **0** | [BENCHMARK](BENCHMARK.md) |

The ablation removes each capability in turn; the failure mode is not "slower" but **wrong version / wrong source / installed but never loads / silent failure**:

- 5,065 catalog entries, 287 same-name groups; in **51 groups** "first hit / highest stars" installs a different source
- In 8 real packages, **2 `latest` releases reject the host**; naive peer handling misjudges **4/8** as "not installable"
- Same registry metadata: npmjs **784 ms** vs mirror **13 ms** (60.3×)
- GitHub-only repo entry probe: **404** (source only, no build output)
- Simulated "installer says applied, but no entry in the process": without verification, a **silent failure is reported as success**
- Logic hot reload **3 ms** vs restart **30–40 s**

Full method and caveats: [BENCHMARK.md](BENCHMARK.md) and [ABLATION.md](ABLATION.md). The numbers cover decisions, trial and error, and verification; **download and compile time cannot be compressed away**.

## Listings

<p align="center">
  <img src="assets/market-dsh-market.png" alt="DSH Settings → Plugin market → Discover, searching plugin-resolve shows dsh-plugin-resolver installed" width="1180">
</p>
<p align="center"><sub>DSH Settings → Plugin market → Discover (search <code>plugin-resolve</code>, screenshot 2026-10-27): installed <code>v0.1.2</code>.</sub></p>

<p align="center">
  <img src="assets/market-dsh-gui.png" alt="DSH → Plugins → Discover: the dsh-plugin-resolver card from a custom index source" width="1420">
</p>
<p align="center"><sub>Inside DSH Desktop → Plugins → Discover with this repository's index source added (screenshot, 2026-10-27).</sub></p>

<p align="center">
  <a href="https://www.dsh.so/zh/artifact/dsh-plugin-resolver/"><img src="assets/market-dsso.png" alt="dsh.so listing: L5 run-verified, low risk, MIT" width="1214"></a>
</p>
<p align="center"><sub><a href="https://www.dsh.so/zh/artifact/dsh-plugin-resolver/">dsh.so</a> listing (screenshot, 2026-10-27): L5 run-verified · low risk · MIT.</sub></p>

<p align="center">
  <a href="https://dshbase.com/plugins/dsh-plugin-resolver/"><img src="assets/market-dshbase.png" alt="dshbase listing: Verified, install-tested on dsh, actively maintained" width="1165"></a>
</p>
<p align="center"><sub><a href="https://dshbase.com/plugins/dsh-plugin-resolver/">dshbase</a> listing (screenshot, 2026-10-27): Verified · install-tested on dsh · actively maintained.</sub></p>

Submission status and history live in [PUBLISHING.md](PUBLISHING.md).

## Tests and CI

```sh
npm test        # 29 offline logic checks + 10 host-free harness checks = 39
npm run bench   # plugin-path benchmark (real catalog + registry)
npm run ablate  # ablation (no side effects)
```

- `test/selftest.mjs`: semver subset, version selection, spec parsing, catalog search (offline)
- `test/harness.mjs`: fake Cordis ctx + fake pluginManager driving the real tool bodies
- `test/benchmark.mjs` / `test/ablation.mjs`: measurement scripts against the real catalog and registry
- CI: `test` on every push/PR (Node 24); `ablation` runs manually / weekly on a schedule

> If the default cache directory is not writable in a sandbox or CI, point `DSH_HOME` at a temp directory: `DSH_HOME=/tmp/dsh npm test`.

## Known limitations

- Compatibility follows npm metadata (`peer` / `engines.dsh`); if the host's startup precheck disagrees, the host wins;
- **Replacing an already-loaded plugin** still needs a host restart (loader module cache + packaged host without the Node-internal loader); `plugin_install` reports `restart-required` only when the bundle set or runtime files actually changed;
- Same-name ambiguity is never guessed: pass `owner=` or a full spec;
- The catalog is a community-maintained third-party list; the plugin only guarantees "installed from the declared source at a compatible version", not a security audit;
- GitHub source builds need `pnpm` (PATH or `DSH_PNPM_PATH`) and `tar` on the host; the first build of a large repo is slow.

## Feedback and security

- Questions and feature requests: <https://github.com/sakikoTGW/dsh-plugin-resolver/issues>
- Security issues: use **Security → Advisories → Report a vulnerability** (private report; please don't open a public issue)
- Release process and checklist: see [PUBLISHING.md](PUBLISHING.md)

## License

[MIT](LICENSE)

<p align="center">
  <sub>Built for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> · part of the <a href="https://github.com/sakikoTGW/dsh-plugins">dsh-plugins</a> set · icon and banner sources in <a href="assets/">assets/</a> · <a href="#dsh-plugin-resolver">Back to top ↑</a></sub>
</p>
