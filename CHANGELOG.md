# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-09-01

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

- `zanix generate interactor` now also runs in a plain `space` project (not just `server`/
  `space-server`), landing in its own per-domain folder (`src/<name>/<name>.interactor.ts`).
- Declared version floors bumped for several `@zanix/*` dependencies a freshly generated/updated
  project gets (`@zanix/core`, `@zanix/datamaster`, and `@zanix/validator`/`@zanix/types` via their
  `@zanix/utils` subpath alias) to track upstream renames/new capabilities this CLI now depends on
  (class-level `classMetadata` introspection for `openapi`, a unified `SEARCH_ENGINE`
  selector/config-option renames) — there's no dual-read compat shim on the upstream side, so an
  older floor no longer resolves to a working release.
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
