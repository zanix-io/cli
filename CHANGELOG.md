# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
