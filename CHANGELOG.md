# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`sweepStaleGeneratedModules` never reached a `.zanix-import-*.js` orphan left inside a LINKED
  sibling package's own directory** (e.g. `@zanix/space-ui` mapped to a local `../space-ui`
  checkout via a raw relative-path `deno.json` override) — `importProjectModule` recurses into and
  writes temp files there too, entirely outside the served project's own `root`/`root/src` scope,
  so no later `zanix space dev`/`build` run of either project ever swept it; orphans accumulated
  indefinitely. `recordGeneratedModuleDir`/`sweepRegisteredGeneratedModuleDirs`
  (`import-project-module.ts`) fix this with a small, persistent, machine-global manifest of every
  directory a generated module was ever written into, swept unconditionally at the top of every
  `zanix space dev`/`build` run, from any project on the machine.

- **A plain Ctrl+C could leave Vite's standalone HMR WebSocket server (port `24678` —
  `zanix space dev`'s `middlewareMode` never wires a real `server.hmr.server`) bound but abandoned,
  colliding with the next `zanix space dev` start.** Cleanup ran from
  `self.addEventListener('unload', ...)`, which fires synchronously and never awaits —
  `engine.close()`'s own async WebSocket teardown could still be mid-flight when the process
  exited, and Vite only logs the resulting `EADDRINUSE` (`WebSocket server error: Port 24678 is
  already in use`), never retries. `spaceDevAction` (`commands/space/dev/action.ts`) now registers
  `Deno.addSignalListener('SIGINT'/'SIGTERM', ...)` via the new `createGracefulShutdown`, which
  awaits the full stop-servers-then-close-engine sequence before the process actually exits.

- **A guarded page's `401` under `zanix space dev` could fall through to a raw JSON body instead
  of a login redirect — never in production, only in dev.** `native-runtime-modules.ts`'s own
  (`@zanix/space`) ambient-fallback path — used whenever a served project's own `resolveDenoAt`-based
  resolution can't answer a route/guard file's bare `@zanix/auth`/`@zanix/datamaster`/
  `@zanix/notifications`/`@zanix/utils` import (a real, confirmed gap for a Deno WORKSPACE MEMBER
  project with no `deno.lock` of its own, the lock living at the workspace root instead) — resolves
  against THIS package's own `deno.jsonc`, not the served project's. Those pins had gone stale
  (`@zanix/auth@^1.2.1`, `@zanix/utils@^4.2.1`, `@zanix/datamaster@^1.9.1`,
  `@zanix/notifications@^1.1.0`) relative to what a real project declares today, so `@zanix/auth`'s
  own `redirectUnauthenticatedPageVisit` (loaded via this stale, ambient copy) held a genuinely
  different `HttpError` class than the one a project's own guard actually threw with — its
  `error instanceof HttpError` check silently declined every time, with no error, no warning.
  Reproduced live serving a consumer project: `chat`/`profile` (both `@Guard(requireSession(...))`-
  protected) returned a raw `{"name":"HttpError",...}` JSON body instead of a `302` to `/login`
  under `zanix space dev`, while the identical guard/error/redirect chain worked correctly under a
  plain production boot (`deno run mod.ts`, no ambient-fallback path to diverge through at all).
  Bumped these pins to the served-project-realistic versions in use today
  (`@zanix/auth@^1.4.1`, `@zanix/utils@^4.5.0`, `@zanix/datamaster@^1.9.3`,
  `@zanix/notifications@^1.2.3`) — this mitigates the currently-reproduced case, but the underlying
  gap (`resolveDenoAt` not always avoiding the ambient fallback for a lockless workspace-member
  project) stays open; these pins need to be kept current, not just refreshed once, or the same
  class of silent divergence reopens the moment a served project's own `@zanix/auth`/
  `@zanix/datamaster`/`@zanix/notifications` pin moves past whatever this file declares.

- **`zanix space build --obfuscate` no longer breaks content-addressed immutable caching.**
  Obfuscation used to run as a POST-BUILD pass (`obfuscateFile`) that read each already-written,
  already content-hashed chunk back off disk and overwrote it in place — the hash Vite/Rollup mint
  for `assets/<name>-<hash>.js` is computed from the bundle's PRE-obfuscation content, so it never
  reflected the obfuscated bytes actually being served. Combined with `@zanix/space`'s own
  `AssetsRoute`, which serves every such file with `Cache-Control: public, max-age=31536000,
  immutable`, two builds that genuinely differ (a changed `--obfuscate-exclude`, a bumped
  `javascript-obfuscator` version) could serve DIFFERENT bytes under the EXACT SAME immutable URL
  — a browser that already cached the old bytes trusts "immutable" and never refetches, silently
  stranding it on stale code indefinitely. A real, reported, and reproduced case: a comet chunk
  obfuscated in one deploy, then added to `--obfuscate-exclude` in the next to fix a genuine
  `javascript-obfuscator`-caused runtime crash, kept the IDENTICAL output filename across both
  deploys — clients that had loaded the page before the fix kept executing the OLD, broken,
  obfuscated bytes under that same URL indefinitely after the "fixed" build went live. Fixed by
  `createObfuscationPlugin` (`commands/build/lib/obfuscate.ts`), a real Vite/Rollup build plugin
  now included in `buildSpaceClient`'s own `plugins` array (`commands/space/build/action.ts`)
  whenever `--obfuscate` is set: chunks are obfuscated via `renderChunk`, BEFORE Rollup substitutes
  each chunk's `[hash]` placeholder in its own filename (confirmed empirically that this hook's
  output feeds the final hash, no extra `augmentChunkHash` needed), and the generated `sw.js`
  service worker (a fixed-name `generateBundle`-emitted asset, never a hashed chunk) via a
  `generateBundle` hook ordered after `pwaPlugin`'s own. The emitted hash now always reflects the
  actual served bytes, by construction, regardless of future obfuscation config or
  `javascript-obfuscator` version changes. Also fixed a smaller, adjacent correctness gap while
  obfuscation was already being restructured: `javascript-obfuscator`'s default
  `Math.random()`-backed string-array shuffling made its output non-deterministic run to run, which
  — now that obfuscation feeds the content hash directly — would have minted a brand-new hash (and
  busted every client's cache) on every rebuild, even one that changes nothing at all;
  `buildObfuscatorOptions` now passes a deterministic `seed` derived from the pre-obfuscation code
  itself, so identical source + config + obfuscator version reliably produce the identical hash.
  `zanix build`'s single-file esbuild path (`build-runner.ts`) is unaffected — its `outputFile` is a
  fixed, author-chosen path with no content hash to invalidate in the first place, so it keeps
  obfuscating via the original post-build `obfuscateFile` helper, now shared internally with the
  new plugin rather than duplicated.

- **`zanix space build` shares one `ImportBatchContext` across the whole `buildSpaceClient` call**
  (`commands/space/build/action.ts`), instead of letting `importProjectModule` build a fresh,
  private one per page/layout (its own default when no batch context is passed). Any project file
  reached indirectly by more than one page through a RELATIVE import — a shared layout header, a
  common component several pages import — used to get rewritten to its own temp file and natively
  `import()`-ed again for every page that reached it, real, avoidable work that scaled with the
  project's own page count rather than its actual dependency-graph size. `zanix space dev`'s own
  `src/server/` registration scan already used this exact pattern; `zanix space build`'s
  page-discovery/document-validation pass (`discoverPages`, which runs BEFORE Vite's own timed
  build step) did not. Cleanup is skipped on a failed build — `discoverPages`'s own internal
  `Promise.all` can leave sibling imports genuinely in flight the instant the first one rejects, so
  cleaning up immediately risks a confusing secondary error; left instead for
  `sweepStaleGeneratedModules` (already run at the top of every `zanix space dev`/`build`) to sweep
  on the next invocation, the same self-healing path a killed process already relies on.

- **`detectTransitiveCollisionPackages` (`commands/space/shared/transitive-collision.ts`) now
  catches a project that declares its own direct edge into a colliding package only under a
  subpath alias, never the package's own bare name.** It used to compare each direct import's raw,
  as-declared `imports` key against the real published package name a resolved `jsr.io` URL
  reports — a project declaring `"@zanix/errors": "jsr:@zanix/utils@^X/errors"` (a real, common
  convention several `@zanix/*` packages themselves use internally) rather than a literal
  `"@zanix/utils"` key never matched, silently missing a genuine dual-module-instance risk whenever
  every direct edge into the colliding package happened to be alias-only. A reported, reproduced
  real case: a project importing `@zanix/auth` directly, with its own `@zanix/errors` alias
  pointing at a different `@zanix/utils` version than `@zanix/auth`'s own internal manifest
  resolves under `zanix space dev`'s governing process config — two separate `HttpError` classes,
  so `error instanceof HttpError` failed inside `@zanix/auth`'s own composed
  `redirectUnauthenticatedPageVisit`, silently declining a real, matched `401` instead of
  redirecting it. Detection now resolves each direct import back to its own real package identity
  before comparing, and flags every alias sharing a colliding identity — not just whichever one
  is checked first — since `importProjectModule`/`importProjectDependency` both look up the
  result by whatever alias a project file actually imports.

- **`guardAgainstStaleNativeDependencies`'s own re-exec (`native-dependency-freshness-guard.ts`)
  never passed `--config` to the child process it spawns — only `--lock`.** Without it, the child
  does its own config-file auto-discovery from `Deno.cwd()` — the SERVED PROJECT's own directory
  during a real `zanix space dev`/`build` run, never `@zanix/cli`'s — losing every one of
  `@zanix/cli`'s own internal path aliases (`commands/`, `typings/`, `shared/`, `utils/`) its own
  source needs to resolve itself at all. Previously documented as an "unreproduced outside CI" gap;
  now confirmed live, outside CI, against a genuinely stale global install: the re-exec'd child
  printed `space`'s own command-group help text instead of running `dev`, then threw `Module not
  found "https://jsr.io/@zanix/space/.../bundler/preact/debug"` — both symptoms of `@zanix/cli`'s
  own command-registration graph failing to resolve itself, unrelated to `space`/`dev` specifically.
  The child now also gets `--config <path>` — `getCliConfigPath()`'s own real answer for a local
  checkout, or the shim's own generated `deno.json` (the guaranteed sibling of `cliLockPath` in
  every install shape, per `locateCliLockPath`'s own doc) for a genuine global install. Verified end
  to end against a real served project (`--local` install, a genuinely stale native-dependency
  lock): the re-exec now boots the dev server successfully instead of crashing.

### Added

- **New `--no-cache` flag for `zanix space dev`/`zanix space build`**
  (`commands/space/dev/command.ts`, `commands/space/build/command.ts`,
  `guardAgainstStaleNativeDependencies`/`prepareNativeFreshnessReexec` in
  `commands/space/shared/native-dependency-freshness-guard.ts`/`native-dependency-freshness.ts`).
  The native-dependency freshness check only ever runs a real, live probe once per 24h, caching
  whatever it finds — a maintainer who publishes a new `@zanix/server`/`@zanix/app` and immediately
  runs `zanix space dev`/`build` again could be stuck trusting an EARLIER check's cached "nothing
  newer" answer for the rest of that window, with no way to force a fresh look short of manually
  finding and deleting the cache file by hand. `--no-cache` skips reading that cache for this one
  run, forcing a real check — it still WRITES a fresh cache entry afterward, same as an ordinary
  cache miss, so it never disables caching going forward, only for the run it's passed on.

- **New `--obfuscate-exclude <globs>` flag for `zanix space build`**
  (`commands/space/build/command.ts`/`action.ts`, `excludeObfuscationTargets` in
  `commands/build/lib/obfuscate.ts`). `--obfuscate` used to obfuscate every built `.js` file with
  no way to opt any of them out — including vendor/`node_modules`-derived chunks, where
  `javascript-obfuscator`'s identifier renaming isn't guaranteed safe. A reported, reproduced real
  case: `monaco-editor`'s own self-referencing `static {}` singleton pattern got its self-reference
  renamed to a generated identifier declared nowhere in the output, throwing `TypeError: ... is not
  a constructor` in production the first time it ran. `--obfuscate-exclude` takes comma-separated
  glob(s) matched against each chunk's path relative to `--out-dir` (e.g.
  `--obfuscate-exclude 'assets/monaco*.js,assets/mouseTarget*.js'`) so a project can skip exactly
  the chunks it knows break, without giving up obfuscation for the rest of its own code. Documented
  in `docs/space.md` (`--obfuscate`'s own row now also warns that vendor code is obfuscated too by
  default) and `docs/build.md` (`zanix build`'s single-bundle path already avoids this class of bug
  via its existing `--external`/`--npm` exclusion, now called out explicitly). Deliberately does
  NOT default to auto-detecting/skipping vendor chunks — see `excludeObfuscationTargets`'s own doc
  for the real, confirmed reason a filename-based heuristic would be unsafe here.

## [2.1.0] - 2026-09-09

### Added

- **`zanix prepare -g`/`zanix new` now scaffold a real, publishable `deno.json` (`exports`/
  `publish`) for every project type, not only `library`/`app`.** `utils/config/base.ts`'s
  `baseZnxConfig` used to gate `exports`/`publish` on `type === 'library' | 'app'` — a `server`/
  `space`/`space-server` project got `exports: {}`, unpublishable even once its own team decided it
  should be (the motivating case: `@zanix/iam`, a `space-server` meant to run zero-clone straight
  from JSR). Now unconditional across all five project types.
- **New `--publish [publish:boolean]` flag on `zanix prepare -g`** (`commands/prepare/main.ts`),
  forwarded through `prepareGithubAction`/`createGitWorkflows`
  (`commands/prepare/lib/github/workflows/workflow.ts`) to decide whether
  `.github/workflows/publish.yml` (real `deno publish` CI, gated on `ci.yml` passing) gets written
  alongside `ci.yml`. Defaults by `--project-type`: `true` for `library`/`app` (the common case —
  those exist specifically to publish), `false` for `server`/`space`/`space-server` (usually a
  deployed service, not a JSR package — defaulting this on would mean `deno publish` running, and
  failing, on every push to a repo never registered on JSR). Pass `--publish`/`--publish=false`
  explicitly to override either direction — e.g. a `space-server` that DOES want zero-clone JSR
  distribution, matching `@zanix/iam`'s own real shape.
- **`zanix space dev`/`build` now automatically pick up a newer `@zanix/server`/`@zanix/app` than
  what `@zanix/cli`'s own committed lock has pinned — never falling behind silently, and never
  needing a manual `@zanix/cli` reinstall to notice.** Resolving these two packages natively (see
  the "zero routes" fix below) converges correctly with `@zanix/space`'s own internal imports of
  them, but ties their version to whatever `@zanix/cli`'s own lock happened to have pinned the last
  time it was generated — frozen indefinitely otherwise, with no signal that anything newer exists.
  Before every real run, `native-dependency-freshness.ts` re-resolves each range `@zanix/cli`'s own
  lock already tracks for these two packages, fresh and in total isolation; when a genuinely newer
  release comes back (a caret/tilde/major-only range can never resolve outside its own major, so
  this never silently crosses one `@zanix/cli` itself hasn't been tested against), the whole
  `zanix` process restarts once under a real, merged copy of that lock — `@zanix/server`'s/
  `@zanix/app`'s native resolution and `@zanix/space`'s own internal one still converge, now on the
  fresher version. A 24h cache (mirroring Deno's own `minimumDependencyAge` convention) means this
  costs a real network check only once a day, not on every `zanix space dev` restart. A `scopes`
  import-map override was tried first for this and confirmed, via a real repro, to have no effect
  on a package resolved purely from JSR — only an entry in the LOCK a process's native resolution
  actually consults does. No network access at all (offline, a registry outage) degrades cleanly —
  the check fails silently and `dev`/`build` proceed on whatever's already resolved, exactly as
  before this existed — and that failure is never written to the 24h cache in its own right, so the
  very next invocation genuinely retries instead of silently trusting a result that was never really
  checked.

### Fixed

- **`zanix space dev` could log `Zanix space dev running at http://localhost:<port>` while nothing
  was actually listening on that port, with no error at all.** `@zanix/server`'s own
  `bootstrapServers()` silently returns an empty array (no `Deno.serve()` ever runs) when none of
  the named server types (`rest`/`ssr`/`socket`, always all three here) has a matching route/
  resolver for the project's own Application — a real, confirmed symptom hit in a live consumer
  project. `spaceDevAction` now checks that result (`assertServersStarted`,
  `commands/space/dev/action.ts`) before its own success log: an empty result closes the dev
  engine, logs a clear error naming the port/app/`routesDir`, and exits `1` instead.
- **A bare specifier reached through a project file's own relative-import chain (`importProjectModule`,
  used by `zanix space dev`'s document-validation render probe) could resolve against `@zanix/cli`'s
  OWN configuration instead of the served project's, even when the two genuinely disagree.**
  `resolveReplacement` (`commands/space/shared/import-project-module.ts`) tried `cli`'s own config
  FIRST for any specifier outside `@zanix/space`/`@zanix/app`/`@zanix/server`, falling back to the
  project's own config only when `cli`'s had no answer at all — so a project pinning a version `cli`
  also happens to declare (for its own, unrelated internal reasons) got `cli`'s version instead of
  its own, with no way to override it. A real, confirmed case: a project pinning a prerelease
  version of a dependency saw `cli`'s own, older stable range win instead, crashing the render probe
  on a component the pinned prerelease exports but the substituted version doesn't. The project's
  own config is now tried first, with `cli`'s own config as the fallback for a specifier the project
  never declares at all (the scenario this fallback actually exists for) — `@zanix/space`/
  `@zanix/app`/`@zanix/server` are unaffected either way, already excluded from this fallback
  entirely for their own, separate identity-sharing reasons.
- **`zanix space dev` could register zero real routes for a served project — the SSR route table
  came back empty even though the project's own pages exist and are discovered correctly.**
  `@zanix/server`/`@zanix/app`/`@zanix/app/runtime` were resolved through `importProjectDependency`
  (`commands/space/shared/import-project-dependency.ts`), a STATIC `@deno/loader` computation
  approximating what `@zanix/space` itself transitively needs — but `@zanix/space`'s own internal
  `import '@zanix/server'`/`import '@zanix/app'` statements, once its module code actually runs,
  resolve through Deno's real NATIVE runtime mechanism instead, governed by whatever config/lockfile
  governs the whole `zanix` process. These two computations can genuinely diverge: a real, confirmed
  case had `@zanix/cli`'s own committed lock resolve `@zanix/space`'s internal `@zanix/server`
  dependency to one version natively, while the static computation resolved a served project's own
  fresher pin to a different one — two different resolved URLs, two separate Deno module-cache
  entries, two separate route registries, with `@zanix/space`'s own routes registered into
  whichever instance `spaceDevAction` never reads from. `@zanix/server`/`@zanix/app`/
  `@zanix/app/runtime` now resolve through a plain native `import()` instead (`dev/action.ts`,
  `import-space-app.ts`) — the same mechanism `@zanix/space`'s own internal imports of them already
  use, so both always land on the identical module instance, in every install shape.
  `importProjectDependency`'s own `TRANSITIVE_ONLY_PACKAGES`/config-augmentation machinery — the
  static approximation this replaces — is removed; the function now only ever resolves
  `@zanix/space` (and its own subpaths), which `space.app.ts` genuinely declares itself.

## [2.0.10] - 2026-09-07

### Fixed

- **`@zanix/server` (or any `@zanix/*` package) could load as TWO separate module instances when a
  served project imported it both directly and transitively through a third-party `@zanix/*`
  package it also imported directly** — e.g. a project directly importing `@zanix/server` alongside
  `@zanix/datamaster`, whose own published `deno.jsonc` declares `"@zanix/server":
  "jsr:@zanix/server@^4.0.0"` internally. `instanceof` then failed across the two instances
  (`"ZanixCacheCoreProvider" is not a valid Provider. Please extend 'ZanixProvider'"`), reproduced
  live against real, currently-published packages. Root cause: `import-project-module.ts` always
  eagerly pre-resolved a project's own bare specifier to one fixed, exact URL before native
  `import()` — the project's own direct edge and the third-party package's own internal edge were
  then resolved by two entirely separate mechanisms (this project's own `@deno/loader` resolution
  vs. native resolution governed by whatever config the running `zanix` process itself had), which
  could land on two different concrete versions even when both ranges were semver-compatible.
  `detectTransitiveCollisionPackages` now detects this shape structurally (via a real `deno info
  --json` probe over the project's own direct `@zanix/*` imports) — regardless of whether the two
  editions happen to already match today, since a version bump on either side can split them apart
  later with zero code change on the project's own end. When a genuine risk is found,
  `zanix space dev`/`build` re-exec the whole process once, under a configuration merging in the
  served project's own declarations, and the flagged specifier is left unexpanded instead of
  eagerly collapsed — letting native `import()` converge both edges itself, the same way any
  ordinary Deno project's own dependency resolution already would. A non-fatal pre-flight warning
  (reusing `zanix check-duplicates`'s own lockfile inspection) also now runs at the start of both
  commands, surfacing an adjacent, unrelated hazard (a `@zanix/*` package resolved to two different
  versions within the project's own `deno.lock`) before it can cause a similarly cryptic failure.
  Every other existing resolution path (`PROJECT_ANCHORED_ONLY_PACKAGES`/`TRANSITIVE_ONLY_PACKAGES`,
  covering `@zanix/space`/`@zanix/app`/`@zanix/server` themselves) is untouched — this is strictly
  additive, engaging only for a project genuinely exhibiting this shape.
- **`zanix check-cycles` crashed with `TypeError: Must be a file URL` on any repo with a real
  intra-package cycle — reproduced live against `@zanix/asyncmq` and `@zanix/datamaster`, both of
  which have a harmless cycle that reaches this code path (phase 1's `deno info`/Tarjan pass found
  it and correctly reported it as clean; the crash happened in phase 2's side-effect analysis).**
  `runHarness` (`analyze.ts`) computed its own harness script's path via `fromFileUrl(new
  URL('./side-effects/harness.test.ts', import.meta.url))` — only ever a real `file://` URL when
  `@zanix/cli` itself loads from a local checkout, never once it loads from a REMOTE specifier
  instead (`https://jsr.io/...`), exactly what this command's own documented, CI-recommended
  invocation does (`deno run -A jsr:@zanix/cli check-cycles`), and what a global install
  (`deno install -g jsr:@zanix/cli`) does too. `runHarness` now generates a fresh, real LOCAL
  `.test.ts` file on every run instead, importing `analyze-file.ts` via `import.meta.resolve` (a
  valid absolute specifier regardless of protocol, and never throws on a non-file one) rather than
  converting a URL to a path. The now-redundant static `harness.test.ts` was removed; its logic
  lives in the new, tested `buildHarnessSource`.
- **This repo's own internal `deno task cli:install` never actually exercised `@zanix/cli`'s real
  install path (`setup.ts`'s `jsr:@zanix/cli@version` flow) — a standalone `deno install ...
  ./mod.ts` line installed straight from the local checkout instead, which is exactly why the bug
  above went uncaught internally: a purely local install can never load a module remotely.**
  `setup.ts` now has a `--local` mode (the same welcome/smoke-test/lockfile-sync steps, installing
  this checkout instead of a published version), and `cli:install` is now `deno run -A
  ./src/installation/setup.ts --local` — the maintainer's own day-to-day install and the real
  end-user's installer are the same code, so they can no longer drift apart the way they did here.

## [2.0.9] - 2026-09-07

### Fixed

- **`zanix prepare --docker`'s generated `Dockerfile` for `space`/`space-server` projects installed
  the CLI with a bare, unpinned `deno install -A -g -n zanix jsr:@zanix/cli`** — not the CLI's own
  documented install command (`README.md`'s `/setup` script), and with no version floor, so a fresh
  build silently tracked whatever was currently "latest stable" on JSR. `dockerfile.space.base` now
  runs `deno run -A jsr:@zanix/cli@[version]/setup [version]`, pinned to this CLI's own
  currently-running version — the real, reproducible command a human is already told to use, which
  also propagates `setup.ts`'s own `--config` step (the target version's own published
  `imports`/`nodeModulesDir`), never skipped by the bare install.

- **`zanix space dev` crashed with `Route path "socket=>/__zanix_space_dev__" is already defined in
  "SpaceDevSocket"` whenever a served project's own declared `@zanix/space` version diverged from
  whatever the installed `@zanix/cli` shim had resolved at install time.** `dev/action.ts`,
  `build/action.ts`, `dev/validation.ts` and `import-space-app.ts` all natively imported
  `@zanix/space`/`@zanix/space/dev`/`@zanix/server`/`@zanix/app`/`@zanix/app/runtime` resolved once
  against `cli`'s own config, never the served project's — a version mismatch loaded two separate
  module instances of the same package, and `SpaceDevSocket`'s own static registration ran twice.
  A new `importProjectDependency` now resolves every one of these against the SERVED PROJECT's own
  `deno.json(c)` instead: `@zanix/space` (bare or subpath) relative to `space.app.ts`, and
  `@zanix/server`/`@zanix/app`/`@zanix/app/runtime` — `@zanix/space`'s own transitive dependencies,
  which no real project declares directly — via a temporary config merging in a wildcard entry for
  each (`jsr:@zanix/app@*`, ...) and graphing `@zanix/space` first in the same dependency-constraint
  solve, so the concrete version resolved is always whatever `@zanix/space` itself needs. `@zanix/cli`
  no longer pins or tracks a version for any of the three, in any install shape — this class of bug
  cannot recur just because `@zanix/space` publishes a new version.
- A related instance of the same root cause: `isZanixAppDefinition` compared a bare `Symbol()` brand
  that only matches within the same `@zanix/app` module instance `@zanix/space` itself resolved — a
  diverging instance silently failed the check (`'space.app.ts' must have a default export from
  defineSpaceApp()`) instead of ever crashing loudly.
- A `cliLoader`-resolved specifier landing in `node_modules` under a genuine global install (no local
  config file to read at all) silently failed to reconstruct as a scheme specifier, reproducing the
  exact `does not provide an export named 'jsx'` failure a prior fix (2.0.8) was meant to close for
  good — `reconstructNpmSpecifierFromResolvedPath` now parses the version directly out of the
  already-resolved path via Deno's own npm-cache directory convention, with no config file needed.
- A project's own bare LOCAL alias (e.g. `"triggers/"`) resolved "successfully" against `cli`'s own
  config too under a genuine global install (`cliLoader` silently becomes identical to the project's
  own loader there), and the identity-sharing branch trusted it as a real `cli`-own answer without
  recursing into it — the file's own bare imports never got rewritten. Reproduced live: `Import
  'clients/registry-hub.client.ts' not a dependency`. `cliLoaderHasNoRealLocalAnswer` now recognizes
  this exact shape (a `file://` result under a global install can never be a genuine package
  identity) and falls through to the project's own resolution instead.
- A real global install's shim config silently dropped `nodeModulesDir`, so every served project
  resolved deep npm dependencies against Deno's flat global cache instead of that project's own
  vendored tree — reproduced live, three `npm:` hops deep (`@zanix/space-ui`'s `Modal` →
  `@radix-ui/react-dialog` → `react-remove-scroll` → a legacy "private stub subpath" package),
  `Cannot find module ... verify main entry`. The shim config now propagates it.
- The pre-commit hook failed when every staged file was excluded from `deno lint` (e.g. staging only
  `src/installation/setup.ts`, which can't depend on the `@zanix/utils` logger plugin) — now
  recognized as a pass, not a lint failure.
- A comet built against `@zanix/space/comet`'s own barrel could fail `zanix space build` with Vite's
  `[UNRESOLVED_ENTRY]` on a real `new Worker(...)` call — a server-only middleware file reachable
  through that barrel pulled in `@zanix/utils`'s full `logger`/`WorkerManager` chain instead of the
  browser-safe entry. `ZANIX_DEPENDENCY_VERSIONS['@zanix/space']`'s floor is now `^1.4.2`, where the
  barrel no longer reaches that chain.
- `zanix new space`/`space-server` never declared `compilerOptions.lib`, so a comet/page calling a
  DOM/BOM API directly (`document`, `window`, `navigator`, `HTMLElement`) could fail `deno check`/
  `deno test` inconsistently depending on invocation shape (config-driven discovery resolves a
  DOM-inclusive default; an explicit file path argument resolves a narrower one). Both project types
  now declare `"lib": ["deno.window", "dom", "dom.iterable"]` explicitly, matching `@zanix/space-ui`'s
  own `deno.jsonc`.
- `ZANIX_DEPENDENCY_VERSIONS`/`deno.jsonc`'s own floors for `@zanix/space-ui` (`^1.0.0` → `^2.0.0`)
  now require the real breaking release that fixes `Menu`'s comet incompatibility (`Menu` drops its
  `@zanix/space` dependency and moves out of `./runtime`; `image` is replaced by `visual`) —
  previously allowed but not required, so a project could still resolve the old, comet-broken `Menu`
  under the same range. `deno.lock` regenerated against a full `deno test` run (not `deno check`
  against a single entry file), which is what keeps every command whose own dependencies resolve
  only through a dynamically-imported `action.ts` correctly pinned too — confirmed by diff: every
  change is a paired old-version/new-version swap for a package this project already depended on
  (`@zanix/space-ui@1.0.0→2.0.0`, `@zanix/space@1.4.2→1.5.0`, `@zanix/server@4.2.1→4.2.2`,
  `@zanix/utils@4.2.1→4.4.0`), nothing dropped.
- **`zanix new space`/`space-server`'s generated `dev` task never loaded a project's own `.env`
  file, unlike `start`/`worker` (`deno run --env-file=.env ...`) generated for the exact same
  project.** `zanix space dev` runs as a subcommand of the already-started, globally-installed
  `zanix`/`znx` binary rather than a fresh `deno run <file>` invocation the generated task string
  controls, so there was no Deno-native task-level flag to attach `--env-file` to. `zanix space dev`
  now has its own `--env-file <path>` option (default `'.env'`) that loads and exports the named
  file in-process (`@std/dotenv`'s `load({ export: true })`) before `space.app.ts` is imported, with
  the same missing-file tolerance `--env-file=.env` already has for `start`/`worker`. The generated
  `dev` task now passes it explicitly: `deno install && zanix space dev --env-file=.env`.
- **`zanix check-cycles` crashed with `TypeError: Must be a file URL` on any repo with a real
  intra-package cycle — reproduced live against `@zanix/asyncmq` and `@zanix/datamaster`, both of
  which have a harmless cycle that reaches this code path (phase 1's `deno info`/Tarjan pass found
  it and correctly reported it as clean; the crash happened in phase 2's side-effect analysis).**
  `runHarness` (`analyze.ts`) computed its own harness script's path via `fromFileUrl(new
  URL('./side-effects/harness.test.ts', import.meta.url))` — only ever a real `file://` URL when
  `@zanix/cli` itself loads from a local checkout, never once it loads from a REMOTE specifier
  instead (`https://jsr.io/...`), exactly what this command's own documented, CI-recommended
  invocation does (`deno run -A jsr:@zanix/cli check-cycles`), and what a global install
  (`deno install -g jsr:@zanix/cli`) does too. `runHarness` now generates a fresh, real LOCAL
  `.test.ts` file on every run instead, importing `analyze-file.ts` via `import.meta.resolve` (a
  valid absolute specifier regardless of protocol, and never throws on a non-file one) rather than
  converting a URL to a path. The now-redundant static `harness.test.ts` was removed; its logic
  lives in the new, tested `buildHarnessSource`.
- **This repo's own internal `deno task cli:install` never actually exercised `@zanix/cli`'s real
  install path (`setup.ts`'s `jsr:@zanix/cli@version` flow) — a standalone `deno install ...
  ./mod.ts` line installed straight from the local checkout instead, which is exactly why the bug
  above went uncaught internally: a purely local install can never load a module remotely.**
  `setup.ts` now has a `--local` mode (the same welcome/smoke-test/lockfile-sync steps, installing
  this checkout instead of a published version), and `cli:install` is now `deno run -A
  ./src/installation/setup.ts --local` — the maintainer's own day-to-day install and the real
  end-user's installer are the same code, so they can no longer drift apart the way they did here.

### Changed

- `setup.sh`/`setup.ps1` (confirmed drifted out of sync with each other) consolidated into one
  cross-platform `setup.ts`, published as a real `./setup` export — the README now documents a
  single `deno run -A jsr:@zanix/cli@[version]/setup [version]` install command for every platform.
  `LATEST` now derives from this package's own `deno.jsonc` at runtime instead of a hardcoded
  literal needing a manual bump on every release.
- `--minimum-dependency-age 0` is now documented as a conditional note (only needed when installing
  a version published within the last 24h), not baked into the canonical install command.

## [2.0.8] - 2026-09-04

### Fixed

Three gaps found in one deliberate side-by-side audit of `resolveReplacement`'s two resolution
branches (`cli`'s own config vs. a project's own config), after 2.0.7's fix revealed the pattern —
checking for every OTHER place the same class of mistake could repeat, not just the one reported.

- **The `cliLoader` catch-fallback branch computed `reconstructSchemeSpecifier`'s result only to
  discard it and return the original bare `specifier` instead** — reintroducing the exact "no
  import map for a loose temp file" failure 2.0.4's own fix exists to prevent, just in this
  error-fallback path instead of the main one. Now returns the reconstructed literal it already
  computed, matching the project-anchored fallback's own (already-correct) pattern.

- **A `cliLoader`-resolved specifier landing in `node_modules` was spliced in as a raw `file://`
  path**, missing the exact same CJS/ESM-interop guard the project-anchored `node_modules` branch
  already has (the branch didn't exist when that guard was written). Real, confirmed failure
  (reported live, `zanix-iam`): react's own CJS entry is a runtime `if (process.env.NODE_ENV ===
  'production') { ... } else { ... }` conditional `require`, which Deno's static CJS→ESM
  named-export analysis can't see through — a raw `file://` import of it exposes no named exports
  at all, so `import { jsx } from 'react/jsx-runtime'` failed outright even though the file resolved
  successfully. Now reconstructs the scheme specifier the same way the other branch does.

- **A project's OWN bare specifier resolving to an unexpanded `jsr:`/`http(s):` literal (the raw
  import-map value, not a real resolved version) was spliced in directly, handing the actual
  version-range resolution to native `import()` at runtime — governed by whatever config/lockfile
  the PROCESS itself was started with, never the project's own `newestDependencyDate`
  ({@linkcode readNewestDependencyDate}, 2.0.5).** This is the real, complete fix for the min-dep-age
  failures a project's own fresh dependencies (`@zanix/auth`, `@zanix/datamaster`, ...) kept hitting
  even with `"minimumDependencyAge": 0` set correctly — 2.0.5 only fixed `@deno/loader`'s own
  `Workspace` construction; this closes the other half, where the literal it resolved to still
  needed a SEPARATE, unconfigured native resolution to become a real version. Forces the same real
  dependency-constraint solve (`addEntrypoints`, then re-resolve) 2.0.7 already applies on the `cli`
  side, so the final spliced specifier is always a fully-resolved absolute URL needing no further
  native resolution at all.

New regression tests for all three, plus a re-run of the full `unit`/`integration` suites (786 and
121 tests respectively, 0 failures) — not just the files touched.

## [2.0.7] - 2026-09-04

### Fixed

- **A real regression from 2.0.4's own fix, reintroducing the exact bug that fix was meant to
  prevent.** `resolveReplacement` spliced `cliLoader.resolveSync(specifier, ...)`'s return value
  directly into the rewritten temp file — but for a `jsr:`/`http(s):` target, that value alone can
  be an UNEXPANDED literal (the raw import-map value, e.g. `jsr:@zanix/space@^1.1.0`), not a real
  resolved version. Splicing that literal in let native `import()` perform its OWN, separate
  version-range resolution at runtime — which can land on a DIFFERENT actual version than whatever
  `@zanix/cli`'s own static import of the same package already resolved to, silently loading a
  SECOND module instance of a package meant to be a process-wide singleton. Reproduced live: `zanix
  space dev` crashed with `Route path "socket=>/__zanix_space_dev__" is already defined in
  "SpaceDevSocket"` — two separately-loaded `SpaceDevSocket` instances (`@zanix/space`) each
  registering the same dev-socket route as a top-level side effect, exactly the failure mode
  `resolveReplacement`'s whole deferral mechanism exists to prevent.

  Fixed by forcing a real dependency-constraint solve before using the resolved value — mirroring
  `@zanix/space`'s own `resolveDenoAt` (`deno-optimize-deps-alias.ts`), which documents solving the
  identical problem the identical way: `cliLoader.addEntrypoints([cliResolved])` followed by a
  second `resolveSync` on the now-graphed literal, returning the real, canonical resolved URL. New
  regression test (`src/@tests/unit/commands/space/shared/import-project-module.test.ts`) asserts
  the rewritten temp file's own specifier is a fully-versioned URL, never a bare semver range.

## [2.0.6] - 2026-09-04

### Fixed

- **`zanix space dev`'s first real page render, for either renderer, crashed with `Import
  "react/jsx-dev-runtime" not a dependency` (or the `preact` equivalent).** Declaring a renderer's
  bare package name (`"react": "npm:react@^19.2.0"`) doesn't make its subpaths resolvable through
  Deno's own native import-map resolution — confirmed via a real, isolated repro: `@deno/loader`'s
  own `resolveSync` auto-expands an aliased bare package's subpaths, but Deno's native resolver
  (used by `RealImportEvaluator.runExternalModule` in `@zanix/space`, natively importing a
  Vite-transformed SSR module from a temp file — Vite's own React/Preact SSR dev transform always
  injects a literal `import {jsxDEV} from 'react/jsx-dev-runtime'`) does not. Every subpath actually
  reached needs its own explicit entry, same as every other subpath this file already declares
  (`preact/hooks`, `@zanix/space/dev`, ...) for the identical reason — `react/jsx-runtime` and
  `react/jsx-dev-runtime` (and the `preact` equivalents) simply weren't among them yet. New
  regression test (`src/@tests/unit/deno-jsonc-renderer-jsx-runtime-subpaths.test.ts`) locks in all
  four entries.

- **The official installer (`src/installation/setup.sh`) had two of its own real gaps, found while
  verifying this release against a genuine global install** (committed separately, folded into this
  release): its own `deno install` line never passed `--minimum-dependency-age`, so installing a
  version published within Deno's default 24h window (routine right after a release) rejected
  outright; and even once installed, `deno install -g`'s own generated shim lockfile only ever
  captured the static import graph, leaving any dependency only reachable through a
  dynamically-imported `action.ts` (this repo's own lazy-dispatch pattern) still gated by the
  default 24h window regardless of this package's own `minimumDependencyAge`. Both fixed: the
  install step now passes `--minimum-dependency-age 0` (matching this repo's own internal `deno
  task cli:install`), and a new post-install step merges the published `deno.lock` into the shim's
  own generated one (add-only, never overwriting what `deno install` itself already resolved).

## [2.0.5] - 2026-09-04

### Fixed

- **A project's own `"minimumDependencyAge"` (its `deno.json`) had zero effect on `zanix space
  dev`/`build`'s own dependency resolution — every `Workspace` this package constructs (both for
  its own config and for a served project's) never translated that field into `@deno/loader`'s
  `newestDependencyDate` option, so Deno's default 24h freshness window always applied regardless
  of what either config declared.** Reproduced live: a real global install still rejected a
  same-day `@zanix/auth` release with `Could not find version of '@zanix/auth' that matches
  specified version constraint '^1.1.2' ... newer than the specified minimum dependency date`, even
  with `"minimumDependencyAge": 0` set in the served project's own `deno.json` — this package's own
  identical `2.0.4` fix (`deno.jsonc`) only ever addressed a DIFFERENT part of this same problem
  (`deno install -g`'s shim never baking the setting in at all); this is the part that was still
  broken even when the RIGHT config was actually reachable.

  Fixed with a new `readNewestDependencyDate(configPath)` helper, now passed to every `Workspace`
  construction: reads the discovered config's own `minimumDependencyAge` (a number in minutes, or
  an absolute RFC3339 cutoff string) and converts it into the cutoff `@deno/loader` needs. Also
  works around a real type/runtime mismatch found in `@deno/loader@0.5.0` itself along the way:
  `WorkspaceOptions.newestDependencyDate` is typed as `Date`, but its actual WASM binding rejects a
  real `Date` instance at runtime (`Failed deserializing workspace options.: ... expected an RFC
  3339 formatted date and time string`) — only the ISO string form works. New regression tests
  (`src/@tests/unit/commands/space/shared/import-project-module.test.ts`) cover the numeric-minutes
  shape, the real `0` shape this ecosystem's own consumers use, the absolute-date-string shape, and
  every case that should fall back to Deno's own default.

## [2.0.4] - 2026-09-04

### Fixed

- **`resolveReplacement` left a bare specifier that also resolves via `@zanix/cli`'s own config
  (e.g. `@zanix/space`, `@zanix/app`, `@zanix/server`) completely untouched in the rewritten temp
  file, "deferring entirely to native resolution" — that only works when the WHOLE running `deno`
  process happens to share `cli`'s own config (a local checkout).** Reproduced live against a real
  global `deno install -g jsr:@zanix/cli@2.0.3` install (found while validating this release):
  `zanix space build`/`dev` on any project importing `@zanix/space` in `space.app.ts` failed with
  `Import "@zanix/space" not a dependency`, thrown from the rewritten temp file itself — a LOOSE
  file living in the project's own directory, not part of any package's own module graph, so it has
  no per-package manifest of its own to resolve a bare specifier against; it can only resolve one
  via whatever import map governs the whole process, which under a real global install has no entry
  for the packages this deferral was relying on being reachable through.

  Fixed by splicing in the already-computed resolved absolute URL (`cliResolved`) instead of the
  original bare specifier — a fully-qualified specifier resolves identically no matter which config
  governs the process, with no import map lookup needed at all. This still preserves the shared
  module instance the surrounding identity-sharing mechanism depends on (the real, previously fixed
  `SpaceDevSocket` "already defined" double-instance bug this whole function exists to prevent):
  Deno's module cache keys by resolved URL, not by which import statement reached it, and
  `@deno/loader`'s own `resolveSync` mirrors Deno's native resolution algorithm by design, so both
  paths converge on the identical cache key. New regression test
  (`src/@tests/unit/commands/space/shared/import-project-module.test.ts`) exercises `resolveReplacement`
  for real against a live `@zanix/helpers` import and asserts the rewritten temp file no longer
  contains the bare specifier.

## [2.0.3] - 2026-09-04

### Fixed

- **`getCliLoader()` called `fromFileUrl(import.meta.url)` unconditionally — the same
  `import.meta.url`-assumes-`file://` bug class as 2.0.1/2.0.2, one level deeper.** It computes
  `@zanix/cli`'s own nearest config path, used by `resolvesIntoCliOwnSourceTree()` to detect a real
  alias collision between the CLI's own internal `typings/`/`shared/`/`utils/` aliases and the
  identically-named aliases `zanix new` scaffolds into a consuming project. Once `@zanix/cli` itself
  loads via `jsr:` (any real global install), `import.meta.url` is `https://jsr.io/...`, and
  `fromFileUrl` throws `Must be a file URL` on every invocation of the affected code path. Fixed by
  guarding the call behind an `import.meta.url.startsWith('file://')` check — when false,
  `cliConfigPath` stays `undefined`, which is the structurally correct answer (there's no local CLI
  source tree to collide with), not just a crash-safe fallback: `resolvesIntoCliOwnSourceTree()`
  already treats a falsy `cliConfigPath` as "no collision," and `getLoaderFor(undefined)` triggers
  `@deno/loader`'s own config-file auto-discovery, which resolves to the same config the served
  project's own resolution already uses. New regression test
  (`src/@tests/unit/commands/space/shared/import-project-module.test.ts`) parses the function's own
  source text and fails loud if the scheme guard is ever removed — the actual runtime branch can't
  be exercised directly, since `import.meta.url` is fixed per module instance within one `deno test`
  run.

- **This package's own dependency resolution (its static `@zanix/server` import, among others) had
  no `minimumDependencyAge` override, so a freshly published `@zanix/server` release could be
  silently excluded by Deno's default freshness gate** — reproduced live: a real global
  `deno install -g jsr:@zanix/cli` install of `zanix space dev` rejected an already-published
  `@zanix/server` version with `Could not find version of '@zanix/server' that matches specified
  version constraint '^4.2.1' ... newer than the specified minimum dependency date`, even though the
  SERVED project's own `deno.json` already set `"minimumDependencyAge": 0` — that setting only ever
  governs a project's own dependency graph, never this package's separate one. Re-installing the CLI
  itself with `--min-dep-age 0` doesn't substitute for this either: that flag only affects
  `deno install`'s own one-time resolution at install time, not the resolution `zanix` performs on
  every later invocation. Fixed by setting `"minimumDependencyAge": 0` directly in this package's own
  `deno.jsonc`. New regression test (`src/@tests/unit/deno-jsonc-minimum-dependency-age.test.ts`)
  parses `deno.jsonc` and fails loud if that setting is ever removed.

## [2.0.2] - 2026-09-04

### Fixed

- **Five separate dynamic `import()` calls under `src/commands` used a bare, `deno.jsonc`
  local-alias specifier (e.g. `commands/space/dev/action.ts`) instead of a relative one — every one
  of them broke once `@zanix/cli` runs from a real global `deno install -g jsr:@zanix/cli`
  install**, not just from a local checkout: `deno install -g`'s own generated shim carries no
  import map at all, so a bare specifier throws `Import "commands/..." not a dependency` at
  runtime, whether the specifier reached `import()` through a variable (three of the five — see
  below) or as a plain inline string literal (the other two). Every affected call already sat
  behind a deliberate LAZY-import boundary in the first place (see each file's own doc: keeping
  Deno's static dependency-graph analysis from eagerly resolving that command's own heavy
  transitive deps — Vite/React/Tailwind/`sharp`/`esbuild`/etc. — for every OTHER `zanix`
  invocation), so this broke `zanix build`, `zanix space dev`, and `zanix space build` outright
  once installed from JSR, on every real invocation of each.

  Fixed by switching every one to a RELATIVE specifier instead — plain ECMAScript module
  resolution against `import.meta.url` needs no import-map lookup at all, so it works identically
  whether that URL is `file://` (a local checkout) or `https://jsr.io/...` (any real global
  install), while still defeating Deno's static analysis the same way a bare one did (still not an
  inline literal the analyzer can trace, for the three that were already routed through a named
  constant).

  - `src/commands/build/main.ts`: `BUILD_LIB_MODULE_SPECIFIER` → `./lib/mod.ts`
  - `src/commands/space/dev/command.ts`: `SPACE_DEV_ACTION_SPECIFIER` → `./action.ts`
  - `src/commands/space/build/command.ts`: `SPACE_BUILD_ACTION_SPECIFIER` → `./action.ts`
  - `src/commands/space/build/action.ts`: its own `compile-messages.ts` import (two separate call
    sites) and `graphql-check.ts` import → `../shared/compile-messages.ts` /
    `../shared/graphql-check.ts`
  - `src/commands/space/dev/action.ts`: its own `graphql-check.ts` import → `../shared/graphql-check.ts`
  - `src/commands/space/shared/graphql-check.ts`: its own nested `discover-graphql-schemas.ts`
    import → `./discover-graphql-schemas.ts`

  A new regression test (`src/@tests/unit/commands/lazy-command-specifiers-relative.test.ts`)
  covers both shapes: the three named constants directly, and a generalized sweep reading
  `deno.jsonc`'s own real local-alias map and scanning every dynamic `import()` under
  `src/commands` for one — so a future instance of the same mistake, anywhere in the tree, fails
  loud instead of shipping unnoticed.

## [2.0.1] - 2026-09-04

### Fixed

- **`check-cycles`'s own harness path resolved at module top level, breaking every `zanix`
  invocation once installed globally from JSR** — `analyze.ts` computed
  `fromFileUrl(import.meta.url)` as a module-level constant; that only works when the module
  itself loaded from a real `file://` URL (running from a local checkout). Installed via
  `deno install -g jsr:@zanix/cli`, this module loads from `https://jsr.io/...` instead, and that
  top-level call threw `TypeError: Must be a file URL` — on `--version`, `--help`, and every real
  command, not just `check-cycles`, since the module is imported regardless of which subcommand
  runs. Moved the path resolution into `runHarness`, computed lazily only when `check-cycles`
  itself actually executes.

## [2.0.0] - 2026-09-03

### Added

- **`zanix generate <artifact> <name>`** (alias `zanix g`) — an entirely new command (nothing like
  it existed in `1.0.7`): adds one artifact to an already-scaffolded project. Ships with `comet`,
  `component`, `connector` (`--slot database|cache:<subtype>` for a custom core-connector
  implementation), `dlqprocessor` (`-p/--process-type`, `-s/--schedule`, both required),
  `globalmiddleware`/`middleware` (`--kind guard|pipe|interceptor`, required), `handler`
  (`-t/--type rest|graphql|socket|ssr`), `interactor`, `job` (`--cron` for a scheduled job),
  `layout`, `loading`/`error`/`not-found` (route-boundary generators matching `@zanix/space`'s own
  conventions), `openapi`, `page`, `repository`, `rto` (repeatable `--field name:type`), `seeder`,
  and `subscriber` (`-q/--queue`). See `docs/generate.md`/`docs/generate-space.md`.
- **`zanix generate openapi [root]`** — statically introspects a `server`/`space-server` project's
  REST route metadata (via a real subprocess `Zanix.compose()` call — decorator metadata only
  resolves reliably in-process) and writes a full OpenAPI 3.0.3 spec to `openapi.json`, overwriting
  it on every run. `--application <name>` scopes the spec to one Application; `--include-admin`
  (off by default) additionally surfaces `@zanix/admin`'s built-in admin routes. Renders a real
  nested `object` schema for a `@ValidateNested(NestedRTO)` field and merges every stacked
  decorator on one field into a single schema, instead of falling back to `{}`.
- **`zanix generate middleware <name> --kind guard|pipe|interceptor`** — scaffolds
  `shared/middlewares/<name>.<kind>.ts` on `@zanix/server`'s `defineMiddlewareDecorator`.
  **`zanix generate globalmiddleware <name> --kind guard|pipe|interceptor`** — a structurally
  different sibling: writes a `.defs.ts` DSL definition (`registerGlobalPipe`/`registerGlobalGuard`/
  `registerGlobalInterceptor`) that's auto-discovered and runs against every request, instead of a
  decorator applied by hand. `zanix new` now seeds an empty `src/shared/middlewares/` into every
  non-`library` project type.
- **`zanix generate graphql-schema`** — for `space`/`space-server` projects: discovers every
  `GraphQLClient` opted into `schemaApplication: { external: true }`, introspects its live
  `baseUrl`, and writes the result to `gql/<name>.schema.graphql`. `zanix space build`/`dev`'s
  GraphQL check reads this cache back to validate a client's queries against the real schema.
- **`zanix check-cycles [-p/--path <path>]`** — detects a real, previously-shipped bug class: an
  intra-package circular import combined with a top-level side effect that reads a binding still
  inside that same cycle (`deno info --json` graph + Tarjan SCC + a real AST pass). Exits non-zero
  on a confirmed finding. **`zanix check-duplicates [-p/--path <path>]`** — detects a `@zanix/*`
  package resolved to more than one distinct version at once in `deno.lock` (the dual-package-
  hazard shape behind a real `Target is not a constructor` DI incident), reading `deno.lock`'s own
  `specifiers` map with no dependency resolution of its own. Both are wired into `zanix prepare -g`'s
  generated `ci.yml` and `pre-push` hook, and into `zanix new`'s generated `deno.json` as
  `deno task check-cycles`/`check-duplicates` for every project type. See `docs/check-cycles.md`/
  `docs/check-duplicates.md`.
- **`zanix credentials mesh <id1> <id2> ...`** — generates a matched RSA keypair per service
  identity and prints ready-to-paste, correctly cross-referenced `.env` blocks
  (`JWK_PRI_<id>`/`JWK_PUB_<id>`/an empty `SERVICE_PERMISSIONS_<id>=`) for `@zanix/auth`'s
  service-to-service mesh. **`zanix credentials password-hash [password]`** — hashes a password
  (`generateHash()`) and prints a pre-quoted `<salt-hex>$<hash-base64>` value, closing a real Deno
  `--env-file` footgun (an unquoted `$` in the hash gets silently truncated by dotenv-style
  expansion); prompts interactively (hidden input, typed twice) when no argument is given.
  `--level`/`--var-name` options. Neither subcommand ever writes a file. See `docs/credentials.md`.
- **`zanix report-issue`** — files a GitHub issue via the REST API (no `gh` CLI dependency),
  deduplicating against an exact-title match among the target repo's open issues. `--repo` defaults
  to `claude-skills`. See `docs/report-issue.md`.
- **`zanix space <dev|build>`** — a new command family for `@zanix/space` frontend tooling. `dev`
  runs a project with real file-watching HMR; `build` produces the real, production client bundle
  (comets, CSS, PWA icons/service worker, and their manifests), with `--obfuscate` sharing
  `zanix build`'s own obfuscation config. See `docs/space.md`.
- **`zanix new space/spacecraft --template welcome`** — a second `--template` preset: a real welcome
  page composed from `@zanix/space-ui`'s `Link` component, independent of `--icons`/`--renderer`.
- **`zanix new space/spacecraft --theme <default|astronaut>`** — scaffolds a curated starter CSS
  theme, or a distinct dark "deep space" palette with its own interactive demo comet, into
  `theme/` (a sibling of `assets/`, never nested under it). Independent of `--template`/`--icons`.
- **`zanix new space/spacecraft --icons`** — scaffolds `@zanix/space-ui`'s default icon catalog
  into `assets/icons/` plus a pre-wired `CatalogIcon` wrapper; declares `@zanix/space-ui` in the
  generated `deno.json`.
- **`zanix new space/spacecraft --renderer <react|preact>`** — picks the JSX renderer (`react` by
  default); affects only `deno.json`'s `jsxImportSource`/dependency and `space.app.ts`'s
  `defineSpaceApp({ renderer })` — every generator template is renderer-agnostic already.
- **`zanix new server/spacecraft`** now also seed a `worker.ts` entrypoint (`Zanix.startWorker()`)
  and a matching `worker` task — a standalone AsyncMQ background-jobs process, always separate from
  `mod.ts`'s own `start`.
- **`zanix prepare --docker [-p/--project-type <type>]`** — generates a `Dockerfile`/`.dockerignore`
  for containerized deployment (every type but `library` gets a `Dockerfile`). `-p app` additionally
  scaffolds a standalone `serve.ts` (`bootstrapRemoteApp`) and `serve` task for a `@zanix/app`-based
  project with no server of its own. Every generated runtime image (and `-p app`'s `serve` task)
  provisions/grants `ffmpeg`/`ffprobe` for `@zanix/space`'s `VideoTranscoder`, inert unless a
  project's own code actually calls it.
- A real ICU→AST message compiler (`compileCatalog`/`compileMessagesTree`/`assertNoCompileFailures`,
  `commands/space/shared/compile-messages.ts`) — the build-time half of `@zanix/space`'s i18n story
  (`@zanix/space-ui` consumes the compiled output at runtime). Wired into `zanix space build` only;
  `zanix space dev` still reads raw ICU JSON directly.
- `README.md`, `docs/*.md`, and `docs/engineering.md` — real command documentation and a durable
  architecture reference, replacing a stale generic README template and a missing `docs/`.

### Changed

- **The scaffold-tree-modeling types (`ZanixFolderTree`, `ZanixBaseFolder`,
  `ZanixSrcTree`/`ZanixSrcTreeMap`, `ZanixServerSrcTree`, `ZanixSpaceSrcTree`, `ZanixLibrarySrcTree`,
  `ZanixFolderGenericTree`, `ZanixTemplatesRecord`, `ZanixLocalContentProps`, `ZanixTemplates`,
  `ZanixProjectsFull`) moved from `@zanix/utils/types` into this package's own
  `src/typings/tree.ts`** — `cli` was always their only real consumer across the whole ecosystem
  (confirmed by a full grep of every other `@zanix/*` package), the same "moved to `cli`, its only
  real consumer" pattern already applied to the git-hook/editor-config helpers and the esbuild
  `CompilerOptions`/`compileAndObfuscate` pair. Internal only — no change to any `zanix` command's
  behavior or output. `ZanixProjects` itself stayed in `@zanix/utils`: it's genuinely shared
  vocabulary, part of the `Znx.config.project` runtime global `@zanix/server` and consumer apps
  read.
- `zanix generate interactor` now also runs in a plain `space` project (not just `server`/
  `space-server`), landing in its own per-domain folder (`src/<name>/<name>.interactor.ts`).
- Declared version floors bumped for several `@zanix/*` dependencies a freshly generated/updated
  project gets (`@zanix/core`, `@zanix/datamaster`, `@zanix/app`/`@zanix/app/runtime`, and
  `@zanix/validator`/`@zanix/types` via their `@zanix/utils` subpath alias) to track upstream
  renames/new capabilities this CLI now depends on (class-level `classMetadata` introspection for
  `openapi`, a unified `SEARCH_ENGINE` selector/config-option renames) — there's no dual-read
  compat shim on the upstream side, so an older floor no longer resolves to a working release.
- `zanix new space`/`space-server` now scaffold an explicit renderer entry point
  (`@zanix/space/react` or `/preact`) in `space.app.ts`, and generated SSR handler shells import
  `renderToResponse` from the same subpath — `@zanix/space` no longer ships a renderer
  implementation of its own. `zanix space dev`'s render probe and Vite plugin now use whatever
  renderer the application itself activated, instead of reading `@zanix/space`'s renderer registry
  directly.
- The `build`, `prepare` (Git/GitHub/editor scaffolding), and `new` project-tree implementation
  moved into this repo from `@zanix/utils` (the only real consumer). `zanix new server`'s example
  files and `zanix new library`'s `mod.ts` starter are now generated locally by this repo's own
  templates instead of fetched over JSR from another package's `src/templates/`.
- `.github/workflows/ci.yml` (both this repo's own and the one `zanix prepare --github` writes) now
  runs `deno fmt --check`/`deno lint` as their own steps, before `check-cycles`/`check-duplicates`.
- `zanix prepare --docker`'s `space`/`space-server` runtime image now ships only what production
  actually needs (`src/`, config, compiled `.dist/client`) instead of the whole project tree
  (previously also shipped `theme/`, raw `assets/`, `docs/`, tests, ...); its build stage now runs
  the project's own `deno task build` instead of a second, independently-maintained `zanix space
  build` invocation.
- `zanix space dev`/`build` now warn (instead of silently ignoring) when a project's own `"links"`
  override can't be honored, because `@zanix/cli` itself is running from a local checkout.
- `CHANGELOG.md`/`LICENSE` moved from `docs/` to the repo root. `toKebabCase`/`toPascalCase` moved
  out of this repo into `@zanix/utils`'s `helpers` module — every internal call site now imports
  them from there instead.
- The publish workflow now syncs the installer scripts' (`setup.sh`/`setup.ps1`) fallback version
  with `deno.jsonc`'s real `version` before publishing.

### Changed (breaking)

- The installed binary is now `zanix` instead of `znx` — `znx` was never actually installable as a
  second alias. Run `deno uninstall -g znx` once, then reinstall as `zanix`.
- `zanix new` no longer scaffolds a `zanix/` folder (`config.ts`/`secrets.sqlite`) — both were
  always generated empty and nothing in the ecosystem reads them.
- `zanix.hash` is no longer written to a generated project's `deno.json(c)` — it was written and
  re-derived but never read by any real consumer. An existing project's already-written value is
  left as a static, inert field.

### Removed

- `zanix new space`/`zanix new app` no longer scaffold `src/shared/middlewares` (the `@Guard`/
  `@Pipe`/`@Interceptor` examples) — dead code by construction for a project type that never boots
  a `'rest'` server. `server`/`space-server` are unaffected.
- `getAllZanixLibrariesInfo` (an all-nine-`@zanix/*`-libraries batch version lookup) removed — its
  only real consumer had already migrated to a one-library-at-a-time resolver, and the batch call
  could never succeed while `@zanix/worker` stays unpublished on JSR.

### Fixed

- **`zanix new`/`zanix generate`/`zanix prepare` scaffold `src/typings/index.d.ts` as ambient
  global types (`declare global { ... }`) for every project type, but never wired
  `compilerOptions.types` at it in the generated `deno.json`** (`utils/config/base.ts`) — without
  that, `deno check`/`deno test` only picked up a type declared there when some
  statically-reachable file happened to import that module, never true for a pure ambient-global
  file; a type used only from runtime-discovered code (e.g. an auto-discovered handler) silently
  went unchecked instead of failing loudly. Now unconditional across all five project types, the
  same way `strict`/`noImplicitAny` already are. Depends on `@zanix/utils` publishing `types` on
  `ConfigFile['compilerOptions']` first (added there in lockstep — see that package's own
  changelog).
- **`zanix space dev` on a `space-server` project never ran `@zanix/core`'s own registration
  sequence** (`dev/action.ts`) — a real `mod.ts` calls `Zanix.start({ apps })`, which registers
  `@zanix/datamaster`/`@zanix/auth`/`@zanix/notifications`/`@zanix/asyncmq`'s own core
  connector/provider slots (`defineCoreMetadata()`) and auto-discovers this project's own
  `src/server/` handlers/interactors/connectors/providers/`.defs.ts` files
  (`defineLocalMetadata()`) BEFORE activating anything. `zanix space dev` never imports `mod.ts` at
  all (a second, unaware production boot racing this one), and drops to
  `activateApps`/`bootstrapServers` directly instead of `Zanix.start()` for dev-only control
  `start()`'s own wrapper doesn't expose — in doing so, it never picked up either registration step:
  a route/Interactor resolving a core connector (`this.database`, ...) threw `Missing core
  connector slot`, and a project-local `src/server/` handler/provider/interactor behaved as if its
  file were never imported at all, purely because `zanix space dev` itself never ran (confirmed as
  a real production failure — a Space page's own login flow reaching a Provider/Repository its
  REST API already registers). Now calls `Zanix.compose()` (the public, side-effect-scoped subset
  of `start()` built for exactly this) for the core-metadata half, and does its own project-aware
  `src/server/` scan through `importProjectModule` for the file-discovery half — `compose()`'s own
  internal scan does a plain, un-rewritten native `import()` that would resolve a discovered file's
  bare specifiers against `cli`'s OWN config instead of the project's (the same class of bug
  `importProjectModule` exists to fix), and previously would have turned "some connector lookups
  fail" into "`zanix space dev` refuses to boot at all" for any project using `@zanix/validator`
  (confirmed absent from `cli`'s own `deno.jsonc`, near-universal for RTOs). `importProjectModule`
  now accepts an optional shared `ImportBatchContext` (`createImportBatchContext`/
  `cleanupImportBatch`) so a batch of independently-scanned files that relatively import each
  other — the normal `@zanix/server` module shape — dedupe correctly instead of each becoming a
  second, independent module evaluation of the same source (regression-guarded by a new test,
  `command-live-boot-space-server.test.ts`, verified against both orderings and a real negative
  control). Only for `space-server` — a pure `space` project never resolves `@zanix/core` at all,
  matching `PROJECT_TYPE_DEPENDENCIES['space']`'s own reasoning for never declaring it.
- **`zanix space dev` crashed with `Import "@zanix/notifications" not a dependency and not in
  import map` (same for `@zanix/datamaster`) the moment a route/guard file reached through its SSR
  pipeline bare-imported either package** (`deno.jsonc`) — `@zanix/space`'s own
  `nativeRuntimeModulesPlugin` routes both through `RealImportEvaluator.runExternalModule`, a plain
  native `import()` resolved against `cli`'s OWN governing config (the process `zanix space dev`
  itself started), never the scaffolded project's — the same mechanism already relied on
  `@zanix/auth` being declared in `deno.jsonc` for the identical reason, but `@zanix/notifications`
  and `@zanix/datamaster` were never added. Both now have a matching entry, mirroring `@zanix/auth`'s
  own. Confirmed reproducible against published `@zanix/space@1.1.0`/`1.2.0`; regression-guarded by a
  new test (`native-runtime-module-imports.test.ts`) that does a real dynamic `import()` of every
  `@zanix/*` package on `@zanix/space`'s own `NATIVE_RUNTIME_MODULES` list against this repo's
  config.
- **`zanix space dev`/`zanix space build` could silently resolve a project's own bare specifier
  against `cli`'s OWN internal source tree instead of the project's, whenever the specifier's
  PREFIX matched one of `cli`'s own `typings/`/`shared/`/`utils/` folder aliases** — the exact
  aliases `zanix new` scaffolds into every real project (`import-project-module.ts`) —
  `resolveReplacement`'s own "leave it untouched if `cli`'s config can also resolve it" check
  (there for a genuine reason: `@zanix/space`/`@zanix/server`/`@zanix/auth`/... need real
  shared-identity resolution against `cli`'s own config) had no way to tell that case apart from a
  project's `utils/constants.ts` merely sharing a name with `cli`'s OWN, unrelated
  `src/utils/constants.ts`. Silent as long as both files happened to export the same names;
  surfaced as a confusing `does not provide an export named '...'` error, pointing at `cli`'s own
  file path, the moment they diverged (confirmed against a real project). Now falls through to the
  project's own resolution whenever `cli`'s own answer lands inside `cli`'s own source tree
  (`resolvesIntoCliOwnSourceTree`) — regression-guarded by a new test reproducing the exact
  collision against a real, existing `cli`-side file (`utils/commands.ts`).
- Running any `zanix` command no longer materializes `build`'s/`space`'s entire heavy npm
  dependency tree (`esbuild`, `vite`, `react`/`preact`, `sharp`, `mongoose`, `amqplib`, ...) as a
  side effect of CLI command registration — both are now lazy-loaded only once that specific
  subcommand actually runs.
- `zanix space build` no longer overwrites a project's own hand-authored ICU `messagesDir` source
  when compiling it — compiled output now lands under `{outDir}/messages/...`, never back at the
  source path.
- `zanix space dev` now composes a project's own `preHandler` (`definePreHandler()`), previously
  invisible under `dev` since it only imports `space.app.ts`, never `mod.ts`.
- A dynamically imported project file (`space.app.ts`, a discovered page/layout, a GraphQL
  client/query module) now resolves its own bare specifiers against the CONSUMING project's
  nearest `deno.json`/`"links"` override instead of `@zanix/cli`'s own configuration — fixes real
  `"not a dependency and not in import map"`/wrong-module-instance failures, for both `zanix space
  dev`/`build` and `@zanix/space`'s own page-discovery pass. Also sweeps any stale
  `.zanix-import-*.js` temp file a killed `dev`/`build` process left behind (now excluded from the
  generated `.gitignore`).
- `zanix new space/spacecraft` no longer silently writes an empty project under a non-`'base'`
  `--template` — it was passing the preset name where `createFilesAndFolders` expected the literal
  `'base'`.
- `importSpaceApp` no longer fails to recognize a valid `space.app.ts` when `@zanix/app`'s resolved
  version diverges between `cli`'s and `@zanix/space`'s own dependency graph (`"links"` only
  applies at the workspace root).
- `server`/`space-server` projects no longer get a dead `@zanix/types` import declared. `zanix new
  server`'s default empty RTO example no longer fails `deno fmt --check`. `zanix generate page`
  (and `zanix new space`'s initial page) no longer fails the generated project's own
  `require-access-modifier` lint rule.
- `setup.sh`/`setup.ps1` no longer print a success banner after a real install failure (a failed
  network fetch, a `deno install` error, or a broken post-install smoke test).
- `zanix new <type> <name>` and every `<name>`/`<route-path>`-taking `zanix generate` leaf now
  reject a `..` path-traversal segment, and (for `<name>`) a value that doesn't derive into a valid
  TS identifier, instead of writing through it or emitting invalid code.
- `zanix generate rto --field` rejects two `--field` flags that share the same field name, instead
  of silently emitting a duplicate class member.
- `zanix prepare -d/-g` rejects an invalid `--project-type` instead of silently skipping
  generation the same way a legitimate "nothing to generate for this type" case does.
- `zanix new <type> <name>` no longer silently writes 0-byte files and reports success when it
  can't reach JSR/Shields.io — a failed template fetch now throws, naming the real HTTP status.
  `zanix new server`'s example middleware shells are now generated locally (`planMiddleware`)
  rather than fetched from an `@zanix/core` path that has never actually had content published.
- `zanix new <type> <name> --verify` no longer always reports a false failure — it was resolving
  its file paths against the verification subprocess's own `cwd` a second time, doubling the path.
- `zanix generate job/dlqprocessor/subscriber/connector` now escapes free-text input before
  interpolating it into a generated string literal or JSDoc comment, closing a real code-injection
  gap (an unescaped `'`/`*/` could break out and execute arbitrary statements on import).
- `zanix prepare -g` now surfaces a specific "pre-commit isn't installed" warning instead of a raw
  `Deno.errors.NotFound` when the `pre-commit` binary is genuinely missing from `PATH`.
- `zanix new space/spacecraft --icons` no longer leaves a half-configured project (no `zanix`
  section saved to `deno.json`) when the icon-catalog side effect fails — it now degrades
  gracefully with a warning instead.
- `zanix new <type> <name>`'s generated `deno.json` now always includes a `version` field (required
  by JSR at publish time) and a clearer placeholder package name (`@your-scope/<real-name>`).
- `zanix new app <name>`'s generated `mod.ts` no longer violates its own scaffolded lint rules (a
  `console.log` call, and a default export shape that trips JSR's slow-types check).
- `zanix prepare -g`'s generated `publish.yml` no longer runs `deno publish` on an open, unmerged
  pull request.
- `zanix space dev` now serves a `--renderer preact` project through the matching Vite plugin
  instead of always defaulting to React's.
- `zanix generate`/`zanix new` invoked with no artifact/type now show usage and a clear error
  instead of producing no output at all; every generator/`new` action now properly awaits its own
  async work before considering the command done.
- Fixed a stale-cache bug (`getCommonTree`'s memoization key ignored project `type`), two
  `toKebabCase`/`toPascalCase` edge cases (a leading/trailing separator, a run of consecutive
  capitals), `saveZanixConfig` silently swallowing a genuinely corrupted (not just missing) config,
  `--obfuscate` crashing instead of no-op'ing on a valid-but-empty app, a Vite dev-engine resource
  leak on a failed boot, and an argument-ordering bug in the shared `new` argument-registration
  helper.
- `zanix new <type>` no longer silently exits `0` with no output when run in a directory with no
  `deno.json` yet — root cause was an eager, non-lazy config read inside a transitively-imported
  dependency; `mod.ts` now also wraps CLI startup/parsing in a top-level error boundary. A related
  `this`-binding/error-handler bug across nested command groups (affecting any error thrown from a
  leaf action under a mounted group) is also fixed.

## [1.0.7] - 2025-10-17

### Fixed

- Readme installation instructions
- pre commit

## [1.0.6] - 2025-10-17

### Fixed

- Installation dependencies and publish
- Prepare command on new

### Added

- Functional testing

## [1.0.5] - 2025-10-16

### Fixed

- Route paths
- Folder names
- Config imports

### Added

- Pre commit support

## [1.0.4] - 2025-09-08

### Fixed

- Config relative paths fix
- Github config fix

### Added

## [1.0.3] - 2025-03-18

### Added

- Some tests.

### Fixed

- New command

## [1.0.2] - 2025-03-18

### Fixed

- Installation version
- Config module info
- Some documentation

## [1.0.1] - 2025-03-17

### Fixed

- Submodules and Github actions.

## [1.0.0] - 2025-03-17

### Initial Release

- First version of `Zanix Cli`.
- Provides CLI options
