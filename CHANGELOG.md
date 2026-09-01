# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to
[Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-09-01

### Added

- **`zanix credentials mesh <id1> <id2> ...`** — a new top-level command (a sibling of
  `new`/`generate`/`build`/`prepare`/`space`/`report-issue`/`check-cycles`, `mountGroup`-based same
  as `space`), closing a real, confirmed gap: setting up service-to-service auth for a
  multi-identity mesh (`@zanix/auth`'s `createServiceAssertion`/`exchangeServiceCredential`)
  otherwise requires hand-generating and hand-cross-referencing `JWK_PRI_<id>`/`JWK_PUB_<id>` pairs
  across N separate `.env` files, with zero tooling and zero cross-check. Generates one real RSA
  keypair per identity (`generateRSAKeys()` from `@zanix/helpers`), and prints ready-to-paste
  `.env` blocks: each identity's own `JWK_PRI_<id>` (labeled for that identity's own process only),
  its `JWK_PUB_<id>` once per OTHER identity in the mesh (each repetition labeled with which
  process it belongs on), and an empty `SERVICE_PERMISSIONS_<id>=` placeholder the operator fills
  in themselves — granted permissions are an operator policy decision no tool can safely infer, per
  `@zanix/auth`'s own service-credential exchange. **Never writes a file** — stdout only, the same
  boundary every `zanix new`/`zanix generate` scaffold already holds for `.env` itself. Requires at
  least 2 identities (a mesh of fewer than 2 has nothing to cross-reference), rejects a duplicate
  identity, and rejects an identity containing a character that would break the printed `.env`
  line's own shape. Local-dev/first-integration-setup convenience only — never a production
  secrets-provisioning path. See `docs/credentials.md`.

- **`zanix credentials password-hash [password]`** — a new sibling subcommand under the
  `credentials` group, closing a real, confirmed gap: a real consumer (`@zanix/console`'s own
  `login.interactor.ts`) previously documented this as a raw
  `deno eval "import { generateHash } from '@zanix/helpers'; console.log(await
  generateHash('your-password'))"` one-liner, with the plaintext password typed straight into the
  command line (visible in shell history for as long as it persists) and no guardrail against the
  real `--env-file` `$`-expansion footgun below. Hashes a password via `generateHash()`
  (`@zanix/helpers`) and prints the resulting `<salt-hex>$<hash-base64>` value, single-quoted,
  ready to paste into a real `.env` file. **Closes a real Deno `--env-file` footgun**:
  `generateHash()`'s own output carries a literal `$`, and Deno's own `--env-file` parsing applies
  dotenv-style `$VAR`/`${VAR}` expansion to an unquoted value, silently truncating everything from
  that `$` onward with no error at all — printing the value pre-quoted is what actually prevents
  it, not just documenting the rule in prose. Omit the `[password]` argument to be prompted
  interactively instead (`promptSecret`, `@std/cli` — hidden input, typed twice to catch a typo).
  `--level <level>` (default `medium`, matching every current real consumer's own `validateHash()`
  call) selects `generateHash()`'s own `EncryptionLevel`; `--var-name <name>` prints a ready
  `NAME='<hash>'` line instead of the bare quoted value. Never writes a file, never echoes the
  plaintext password anywhere in its own output. See `docs/credentials.md`.

- **`zanix new space/spacecraft --template welcome`** — a real second `--template` preset, the
  first content built on the `PresetName`/`ScaffoldRecipeRegistry` infrastructure
  (`presets.ts`/`recipe.ts`, see `docs/engineering.md` §6). Writes a real welcome landing page
  (`routes/page.tsx`) in place of the generic `Example` route — the same idea as Handlebars' own
  default welcome page for a fresh project — composed from `@zanix/space-ui`'s real `Link`
  component (two real outbound links: "Documentation", "GitHub", both pointing at this ecosystem's
  real `zanix-io` GitHub org). New module: `commands/new/lib/tree/projects/space-welcome.ts`
  (`welcomePageTemplate`/`planWelcomePage`), wired into `space.ts`'s own `SPACE_RECIPES.welcome`.
  Deliberately independent of `--icons` (the welcome page never references `CatalogIcon`, and
  `--icons` never reads `--template`) — the two compose freely, in any combination. Declares
  `@zanix/space-ui` in the generated `deno.json` on its own (via the same `ensureSpaceUiDependency`
  `--icons` already uses), independent of whether `--icons` was also passed. `spacecraft` shares
  the same `SPACE_RECIPES`, so it gets the identical welcome page at the same path; the server half
  of a `spacecraft --template welcome` project is untouched (see the `SERVER_RECIPES.welcome`
  entry below). Its root `<main>` carries a stable `data-space="welcome"` hook — the same
  `@zanix/space` attribute convention `DefaultNotFoundView`/`DefaultErrorView` establish — so
  `--theme`'s own starter CSS can style it too. See
  [`docs/new.md`](./docs/new.md#--template-welcome) for the full option reference.
- **`SERVER_RECIPES.welcome`** — a deliberate alias for `SERVER_RECIPES.base` (same array
  reference, not a copy), added purely so `zanix new spacecraft --template welcome` can resolve at
  all: `getZnxFolderTree` threads the same `--template` value into both `getSpaceSrcTree` AND
  `getServerSrcTree` for `space-server`, and `'welcome'` had no server-specific content to give it
  before this entry existed. A plain `zanix new server --template welcome` also now resolves, to
  output identical to `--template base` — a side effect of the shared registry, not a new
  server-only feature.
- **`zanix new space/spacecraft --theme <default|astronaut>`** — a new, `--template`-independent
  visual-identity axis (`commands/new/lib/tree/themes.ts`). Unset by default (no `globalCss` field
  at all, same as today's unstyled scaffold). `--theme default` (`space-theme.ts`) copies
  `@zanix/space-ui`'s curated starter theme CSS (`theme/tokens.css`, `shared/behavior.css`,
  `shared/card.css`, plus a new, locally-embedded `space-defaults.css`) into a project-root
  `theme/` folder — deliberately a sibling of `assets/`/`src/`, NOT nested under `assets/theme/`:
  `assetsDir` is now always declared (see the `--icons` entry below) and recursively scans/serves
  everything under it as a raw static asset, so a theme stylesheet living inside `assetsDir`'s own
  scan path got double-served (once via its bundled `globalCss` include, once via the raw asset
  scan) — a real, confirmed layout regression from the un-bundled duplicate's cascade position.
  `--theme astronaut` (`space-astronaut.ts`) is a distinct, complete dark "deep space" palette —
  same `globalCss` mechanism, different source files, plus its own decorative starfield/rocket CSS
  and a real interactive "launch a comet" demo that replaces the generic placeholder Comet ONLY
  when `theme === 'astronaut'`, regardless of `--template`. Both wire into the generated
  `space.app.ts`'s `globalCss` — `@zanix/space`'s own real, pre-existing `docs/theming.md`
  composition mechanism, no new one — and reuse `space-icons.ts`'s own `resolveSpaceUiVersion`
  unchanged rather than duplicating the JSR-fetch-at-a-pinned-version gate. `--theme` never reaches
  the `SPACE_RECIPES`/`SERVER_RECIPES` mechanism at all — a visual theme has nothing to say about
  `routes`/`comets` content — its real work runs entirely outside the Recipe mechanism, the same
  "separate step after the recipe's own side effects" shape `--icons` already established for the
  icon catalog; `spacecraft`'s server half is unaffected by either value. Deliberately independent
  of both `--icons` (neither reads the other; `functional/space-theme-live.test.ts` proves the two
  compose freely, real network round-trip both ways — the same file that closes
  `space-icons-independence.test.ts`'s former `.ignore`d "theme + icons" placeholder) and
  `--renderer`. `--theme default` writes NO `deno.json` dependency (every copied file is plain
  `.css`, never imported by any `.ts` module this scaffold generates); `--theme astronaut` declares
  `@zanix/space-ui` on its own (its comet demo imports `Button` from it), independent of `--icons`.
  See [`docs/new.md`](./docs/new.md#--theme) for the full option reference.
- **`ZANIX_DEPENDENCY_VERSIONS['@zanix/space-ui']`** — `@zanix/space-ui` is now a real, published
  JSR package (`0.1.0`), so `zanix new space/spacecraft --icons` can finally resolve a real version
  to fetch its scaffold icon catalog from (`resolveSpaceUiVersion`'s own publish gate, previously
  always tripped — see `space-icons.ts`'s own doc). Same fixed alongside this entry: `resolveSpaceUiVersion`/
  `getSpaceUiIconTemplate`'s previous call into `readFileFromCurrentUrl` (`url, ''`) silently
  stripped the real target filename instead of a placeholder — `getPathFromCurrent`'s real contract
  is `join(callerUrl, '..', relativePath)`, so passing an already-complete URL as `callerUrl` with
  an empty `relativePath` always resolved to the CONTAINING DIRECTORY, never the file (confirmed
  empirically: a real 404 against the now-published `@zanix/space-ui`, not just a theoretical gap).
  Now follows the same `{current}`-placeholder convention `templates.ts`'s own
  `getZanixTemplateContent` already establishes for the same `readFileFromCurrentUrl` call shape.

- **`zanix new space/spacecraft --icons` now declares `@zanix/space-ui` in the generated
  `deno.json`** — the real dependency `src/space/catalog-icon.ts` imports (confirmed empirically:
  a fresh `--icons` scaffold's `deno check` used to fail to resolve the bare `@zanix/space-ui`
  specifier). `ensureSpaceUiDependency` (`space-icons.ts`) calls `ensureZanixDependency` the same
  way every `zanix generate` leaf already does for its own on-demand dependency — one bare
  `"@zanix/space-ui"` import-map entry covers both the React and Preact (`@zanix/space-ui/preact`)
  entrypoints automatically (confirmed against the real published package: `deno check` resolves
  the `/preact` subpath from that single entry, no separate subpath key needed).
  `ensureSpaceScaffoldSideEffects` now returns whether the icon catalog actually landed on disk, and
  `newSpaceAction`/`newSpacecraftAction` call `ensureSpaceUiDependency` right after `saveZanixConfig`
  (never before — `ensureZanixDependency` reads/writes `deno.json` directly, which doesn't exist on
  disk until `saveZanixConfig` writes it), and only when that catalog write actually succeeded.

- **Drift Watch (`scripts/drift-watch.ts`) now exercises `--icons`** — its `space`-variants block
  (`comet`/`component`/`page`/`layout`/`interactor`) now regenerates against a fresh
  `zanix new space --icons` project instead of a plain `zanix new space` one. `@zanix/space-ui` is
  a real `ZANIX_DEPENDENCY_VERSIONS` entry consumed ONLY via the `--icons` scaffold path
  (`ensureSpaceUiDependency`, `commands/new/lib/tree/projects/space-icons.ts`) — without `--icons`,
  no generated project ever declares or imports it, so Drift Watch's one job (catching an upstream
  breaking change against the real, currently-published JSR API) never actually ran against it.
  `newProject(type, extraArgs?)` gained an optional `extraArgs` parameter to make this possible;
  `checkProject`'s own `rewriteToLatestVersions` step needed no change — it already rewrites every
  key present in a generated project's `deno.json` `imports` against
  `ZANIX_DEPENDENCY_VERSIONS`/live JSR data generically, `@zanix/space-ui` included.

- **`zanix generate openapi [root]`** — statically introspects a
  `server`/`space-server` project's own REST route metadata and writes a full
  OpenAPI 3.0.3 spec to `openapi.json` at the **project root**. Unlike every
  other generator, this OVERWRITES `openapi.json` on every run (a
  machine-derived snapshot, not a hand-editable shell), takes no `--verify`
  (its output has zero imports), and is the first generator that actually
  EXECUTES the target project's own code — a real `deno run` subprocess
  rooted at the target project calls `Zanix.compose()` and reads back
  `ProgramModule.routes.getRoutes('rest')`, since native ECMAScript decorator
  metadata only resolves consistently in-process. `--application <name>`
  restricts the spec to one Application. `--include-admin` (off by default)
  additionally forwards `{ admin: true }` to the target project's own
  `Zanix.compose()` call, so `@zanix/admin`'s built-in `'admin'`-Application
  routes (`/admin/service-token`, `/admin/triggers`, `/admin/templates`)
  become discoverable too — deliberately opt-in, matching `Zanix.compose`'s
  (and `Zanix.start`'s) own `admin` option default, since that surface is
  anchored and not meant to be reachable by an arbitrary public caller;
  combine with `--application admin` to produce a spec of just the admin
  routes. Fails with a clear, actionable error (not a raw stack trace) when
  the resolved `@zanix/core`/`@zanix/server`/`@zanix/utils` predates the
  route-introspection support this needs, or — for `--include-admin`
  specifically — when the resolved `@zanix/core` predates `Zanix.compose`'s
  own `{ admin: true }` option — as of this writing, none has published
  either yet. See [`docs/generate.md`](./docs/generate.md#openapi-spec).
- **`zanix generate openapi` renders a real nested `object` schema for a
  `@ValidateNested(NestedRTO)` field, and merges every stacked decorator on
  one field into a single schema, instead of either falling back to `{}`.**
  `discover.ts`'s own subprocess resolves a `ValidateNested` field's live
  nested RTO constructor into plain field metadata via `classMetadata()`
  BEFORE it ever crosses the `JSON.stringify` boundary back into `cli`'s own
  process (recursively, for a nested RTO with its own nested fields, bounded
  by a depth guard against a circular RTO reference) — a live class
  constructor never survives serialization otherwise. `spec-builder.ts`
  renders that resolved metadata as a real `type: 'object'` schema (an array
  of nested objects, when the field is `{ each: true }`), reusing the same
  object-schema logic a `Body` RTO's own top-level schema already uses.
  Separately, a field stacking two or more decorators (e.g. `@IsString()
  @Length({ min, max })`) now merges every stacked decorator's own
  contribution onto one schema object (`type: 'string'` from `IsString`,
  `minLength`/`maxLength` from `Length`) instead of only the last-registered
  decorator winning. Both need a `@zanix/utils` version whose `classMetadata`
  tags `ValidateNested` and reports a field's full `decorators` stack — an
  older `@zanix/utils` degrades to the same honest `{}` any other
  unrecognized decorator already gets, not a crash. See
  [`docs/generate.md`](./docs/generate.md#openapi-spec).
- **`zanix report-issue`** — files a real GitHub issue via GitHub's REST API
  (`POST /repos/zanix-io/<repo>/issues`), no `gh` CLI dependency anywhere
  (confirmed absent in at least one real environment this was designed for).
  Reads a personal access token from `GITHUB_TOKEN`; fails loudly with setup
  instructions when it's unset, and surfaces GitHub's own error body on a
  rejected token (401/403) or an unresolved `--repo` (404) rather than a
  generic failure. `--repo` defaults to `claude-skills` — the common case, a
  skill/agent finding — and takes any other `zanix-io/<repo>` explicitly for
  a real package bug found incidentally. Deduplicates before filing — an
  exact-title match among the target repo's OPEN issues means nothing new is
  created, the existing issue's URL is reported instead (loud, via a
  warning, never silent) — so a periodic sweep re-finding the same
  still-unfixed finding on a later run doesn't file a brand-new duplicate
  every time. See [`docs/report-issue.md`](./docs/report-issue.md).
- **`zanix generate component <name>`** — a plain, presentational
  `components/<name>.tsx` for `space`/`space-server` projects: server-rendered
  like any other JSX in the page tree, no `'use comet'`, no hydration of its
  own, meant to be imported by hand into a `page.tsx`/`layout.tsx`/another
  component's own JSX tree. Not seeded by `zanix new space`/`spacecraft` yet —
  `@zanix/utils`'s own published `ZanixSpaceSrcTree` type has no `components`
  subfolder for a Recipe entry to target today, the same gap
  `zanix generate middleware` already documents for `server`. See
  [`generate-space.md`](./docs/generate-space.md#component).
- **`zanix check-cycles [-p/--path <path>]`** — a new top-level command (same
  bare-`Commander` shape as `build`) that detects a real, previously-shipped
  bug class: an intra-package circular import combined with a top-level side
  effect that reads a binding still inside that same cycle — the exact shape
  behind a real `ReferenceError: Cannot access 'SmtpClient' before
  initialization` in `@zanix/notifications`'s SMTP connector. Resolves the
  package's real intra-package import graph via `deno info --json` (seeded
  from every `deno.json(c)` `exports` entrypoint, not just the root), finds
  every real cycle with Tarjan's strongly-connected-components algorithm, then
  runs a real AST pass (`Deno.lint.runPlugin`) over files inside a cycle to
  find a module-scope statement (a call, a `new`, a top-level `await`, or a
  `class X extends Y`) that reads a binding still imported from another file
  in the same cycle. A bare cycle with no such statement reports clean, not as
  a finding. Exits non-zero on a confirmed finding, safe to gate CI on —
  `zanix prepare -g` now scaffolds a "Check for circular-import hazards" step
  into the generated `.github/workflows/ci.yml` for every project type. See
  [`docs/check-cycles.md`](./docs/check-cycles.md).
- **`zanix generate middleware <name> --kind guard|pipe|interceptor`** — a new
  generator that scaffolds `shared/middlewares/<name>.<kind>.ts`, a shell
  built directly on `@zanix/server`'s `defineMiddlewareDecorator` — the one
  real primitive behind the `Guard`/`Pipe`/`Interceptor` sugar decorators.
  `--kind` is required, the same reasoning `dlqprocessor`'s own required
  options already document: three equally common concerns with no natural
  default to guess at. Apply the generated decorator directly on a handler
  method or a whole class. `zanix new` now seeds an empty
  `src/shared/middlewares` folder (via `main.ts`'s own `MIDDLEWARES_RECIPE`,
  calling this generator's `planMiddleware` directly) into every non-`library`
  project type. See [`docs/generate.md`](./docs/generate.md#middleware).
- **`zanix generate globalmiddleware <name> --kind guard|pipe|interceptor`** —
  a new generator, structurally different from `middleware` above rather than
  a 4th `--kind` bolted onto it: writes a `.defs.ts` DSL definition
  (`registerGlobalPipe`/`registerGlobalGuard`/`registerGlobalInterceptor` in
  `@zanix/server`) that's auto-discovered and runs against every request
  across the server types listed in its own `exports.server` (`['all']` by
  default), instead of a decorator applied by hand to one handler. Lands in
  the same `shared/middlewares/` folder `middleware` seeds. See
  [`docs/generate.md`](./docs/generate.md#global-middleware).
- **`zanix generate graphql-schema`** — a new generator for `space`/
  `space-server` projects, taking no `<name>`: discovers every
  `**/*.client.ts` export shaped like a real `GraphQLClient` opted into
  `schemaApplication: { external: true }`, runs a real introspection call
  against each one's own live `baseUrl` (`GraphQLClient.introspect()`,
  `@zanix/server@^4.1.0`), and writes the result as plain SDL text to
  `gql/<name>.schema.graphql`. Regenerates every target's cache file in full
  on every run — a machine-derived snapshot of a live remote schema, the same
  "overwrite by design" exception `openapi` already documents — never a
  build failure on its own if a cache file doesn't exist yet.
  `zanix space build`/`zanix space dev`'s own GraphQL check (Layer 2) reads
  this cache back to validate a client's queries against the real remote
  schema. See
  [`docs/generate.md`](./docs/generate.md#graphql-schema-cache).

- **`compileCatalog`/`compileMessagesTree`/`assertNoCompileFailures`**
  (`commands/space/shared/compile-messages.ts`) — this package's own ICU→AST
  compiler, the build-time half of `@zanix/space`'s i18n story (the
  runtime/consumption half is `@zanix/space-ui`'s own `createFormatter`; see
  that package's CHANGELOG). Uses `@formatjs/icu-messageformat-parser`'s own
  `parse()` directly — the one real dependency this compiler owns, never added
  to `@zanix/space` (confirmed by a dedicated structural test, not just
  documented) and never paired with `@formatjs/intl` here — the CLI compiles,
  `space-ui` consumes.
  - `compileCatalog(source)` compiles one catalog's ICU string values to
    `MessageFormatElement[]`; an already-array value (a precompiled AST from a
    previous run, or hand-provided) passes through completely unchanged,
    making this idempotent and letting a catalog mix compiled and
    not-yet-compiled values across keys. Fails the WHOLE catalog on the first
    invalid key (`MessageCompileError`, carrying the exact key) — never a
    partial output with the broken key silently skipped.
  - `compileMessagesTree(dirs)` walks every `.json` file under one or more
    `messagesDir`-style roots and compiles each independently — one broken
    catalog does not block the others in the same run from compiling, so a
    single invocation surfaces every problem in the tree at once. Never
    writes to disk and never throws for a catalog failure on its own; returns
    `{ compiled, failures }` for the caller to act on.
  - `assertNoCompileFailures(result)` — the one-call hook `zanix space build`
    uses to turn a non-empty `failures` into a hard build error, without
    hand-rolling the aggregation.
  - Wired into `zanix space build` (not `zanix space dev`, which keeps reading
    raw ICU JSON directly) — see the `writeCompiledMessagesTree`/
    `writeCompiledCatalogs` entry above for the output-location/build-wiring
    half of this feature.
  - Does not port the legacy component's `buildHash` id-namespacing, `.lazy`
    tier, or `formatData`/`formatContent` — see `@zanix/space`'s own
    CHANGELOG for why (the collision problem `buildHash` solved doesn't exist
    in this architecture: `@zanix/space-ui` ships zero translatable strings of
    its own).
  - 25 new tests: 15 behavioral (golden tests against `parse()` directly,
    mixed/idempotent catalogs, the fail-fast-per-file/isolated-across-files
    error policy, malformed JSON, `messagesDir: string[]`), 3 structural
    (`deno info --json`'s real module graph confirms the parser is a genuine
    code dependency here and that neither `@formatjs/intl` nor `react`/
    `preact` ever leak in), and 4 that feed this compiler's real output
    straight into `@zanix/space-ui`'s `createFormatter` — proving the AST
    produced here isn't merely type-compatible but actually consumed
    correctly by the real formatter, not a theoretical fixture.
- `zanix generate <artifact> <name>` (alias `zanix g`) — adds a single artifact
  to an existing project: `seeder`, `repository`, `handler`, `rto` (a field DSL
  via repeatable `--field
  name:type`), `connector`, `interactor`, and `job`
  (`--cron` for a scheduled job instead of an on-demand one). See
  [docs/generate.md](docs/generate.md).
- `README.md`, `docs/{new,generate,build,prepare}.md`, and `engineering.md` —
  real command documentation and a durable architecture reference. Previously
  the README was a stale generic template with no documented commands, and
  `docs/` didn't exist.
- `zanix generate error <route-path>` / `zanix generate loading <route-path>` /
  `zanix generate not-found [root]` — three generators matching `@zanix/space`'s
  own `error.tsx`/`loading.tsx`/`not-found.tsx` route conventions, same shape
  and same pattern as the existing `comet`/`page`/`layout` generators (`error`/
  `loading` are per-route-segment, like `layout`; `not-found` is a single,
  whole-app file at the routes root, taking no `<name>`/`<route-path>`
  argument at all). See
  [docs/generate-space.md](docs/generate-space.md#error-boundary).
- `zanix new space`/`zanix new spacecraft --renderer <renderer>` (`'react'`,
  the default, or `'preact'`) — a new option, independent of `--template`
  (`ZanixTemplates` is a single, cross-project-type union shared by
  `app`/`server`/`library` too; overloading it with a `space`-specific axis
  would leak that concept into project types with no renderer at all).
  Affects exactly two generated files: `deno.json`
  (`compilerOptions.jsxImportSource` + the declared npm dependency, `preact`
  instead of `react`) and `space.app.ts` (`defineSpaceApp({ renderer:
  'preact' })`, omitted entirely for the default `'react'`). Zero changes to
  the `comet`/`page`/`layout`/`error`/`loading` generator templates — already
  renderer-agnostic JSX, transpiling off `deno.json`'s own
  `jsxImportSource` regardless of which renderer was picked. See
  [docs/new.md](docs/new.md#--renderer).
- `zanix space <dev|build>` — a new command family for `@zanix/space` frontend
  tooling. `zanix space dev` runs a project in dev mode with real file-watching
  HMR (SSR module invalidation, browser-facing asset transform, automatic
  reload); `zanix space build` builds the real, production client bundle
  (comets, CSS, PWA icons/service worker, and their manifests), with an
  `--obfuscate` opt-in sharing `zanix build`'s own obfuscation config. See
  [docs/space.md](docs/space.md).
- `zanix generate dlqprocessor <name> -p, --process-type <type> -s, --schedule <cron>` —
  generates a DLQ (dead-letter queue) reprocessing job
  (`dlq/<name>.defs.ts`, `registerDLQProcessor` from `@zanix/asyncmq/dlq`),
  plus `repositories/dlq.defs.ts` (`@zanix/datamaster`'s DLQ model
  registration) the first time this generator runs in a project. Both
  `--process-type` and `--schedule` are required — there's no on-demand DLQ
  processor, unlike `job`. See
  [docs/generate.md](docs/generate.md#dlq-processor).
- `zanix new server`/`spacecraft` now also seed a `worker.ts` entrypoint
  (`Zanix.startWorker()`) and a matching `worker` task in `deno.json` (same
  permissions as `start`, pointed at `worker.ts`) — a standalone AsyncMQ
  background-jobs process, always its own separate process from `mod.ts`'s own
  `start`. Plain `space` projects don't get one (no `@zanix/core` dependency).
  See [docs/new.md](docs/new.md#server) and
  [docs/deploy.md](docs/deploy.md#running-the-worker-process) for how to run it
  in production (the generated `Dockerfile`'s image serves both roles — the
  deployment target picks `start`/`worker` via a `CMD` override, never a
  baked-in platform-specific env var check).
- `zanix prepare --docker [-p, --project-type <type>]` — generates a
  `Dockerfile` and `.dockerignore` for containerized deployment. Every type but
  `'library'` produces a `Dockerfile` (a two-stage build; the
  `space`/`space-server` variant additionally installs real npm deps and runs
  `zanix space build`), `.dockerignore` is generated regardless of type. Docker
  is one deployment option among several, never the assumed default — see
  [docs/deploy.md](docs/deploy.md) and
  [docs/prepare.md](docs/prepare.md#-d---docker).
- `zanix prepare --docker -p app` — a `@zanix/app`-based (`'app'` type) project
  gets real, standalone deploy support: this ALSO scaffolds `serve.ts` (a
  `bootstrapRemoteApp` entrypoint — `mod.ts` alone only exports a manifest,
  never runnable) and a matching `serve` task in this project's own
  `deno.json`/`deno.jsonc` (a surgical merge — reads and writes ONLY
  `tasks.serve`, never touching anything else, and never overwriting an existing
  `serve` task). Shares the exact same Dockerfile template `'server'` uses
  (`dockerfile.process.base`, renamed from `dockerfile.server.base` to reflect
  that) — `'server'`/`'app'` differ only in which file gets cached and which
  task the `CMD` runs (`mod.ts`/`start` vs `serve.ts`/`serve`), never a second,
  near-duplicate template. See [docs/prepare.md](docs/prepare.md#-d---docker)
  and
  [`@zanix/app`'s own README](https://jsr.io/@zanix/app#standalone-remote-deployment-runtime).
- `zanix generate subscriber <name> [-q, --queue <route>]` — generates a queue
  subscriber shell (`subscribers/<name>.subscriber.ts`,
  `@Subscriber`/`ZanixSubscriber` from `@zanix/asyncmq`). `--queue` defaults to
  the kebab-cased name when omitted. See
  [docs/generate.md](docs/generate.md#subscriber).
- `zanix generate handler <name> [-t, --type rest|graphql|socket|ssr]` —
  `handler` now generates 3 additional handler types beyond REST: `graphql`
  (`<name>.resolver.ts`, `@Resolver`/ `ZanixResolver`), `socket`
  (`<name>.socket.ts`, `@Socket`/`ZanixWebSocket`), and `ssr` (`<name>.ssr.ts`,
  `@SsrController`/`ZanixSsrController`). `--type` defaults to `rest`
  (`<name>.handler.ts`, unchanged behavior). See
  [docs/generate.md](docs/generate.md#handler).
- `zanix generate connector <name> [-s, --slot database|cache:<subtype>]` —
  `connector` now supports generating a shell for a **custom** implementation of
  a core connector slot: `--slot
  database` (extends `ZanixDatabaseConnector`)
  or `--slot cache:<subtype>` (extends `ZanixCacheConnector`, e.g.
  `cache:redis`). Without `--slot`, unchanged generic-connector behavior.
  `asyncmq`/`kvLocal`/`search` slots aren't covered. See
  [docs/generate.md](docs/generate.md#connector).
- `zanix new space`/`zanix new spacecraft --icons` — scaffolds
  `@zanix/space-ui`'s curated default icon catalog (a small, Font Awesome
  Free-sourced SVG sprite) into `assets/icons/{catalog.svg,NOTICE.md,LICENSES/}`,
  plus a pre-wired `src/space/catalog-icon.ts` wrapper exporting this project's
  own `CatalogIcon` (`@zanix/space-ui`'s real component, with `href` resolved
  via `@zanix/space`'s `resolveAssetHref`). Off by default, and independent of
  both `--template` and `--renderer` (`renderer` is only consulted to pick which
  `@zanix/space-ui` entrypoint the wrapper imports from) — works with any theme,
  a custom one, or none at all; only writes `space.app.ts`'s
  `assetsDir: './assets'` field when passed. See
  [docs/new.md](docs/new.md#--icons).
- **`ffmpeg`/`ffprobe` runtime support for `@zanix/space`'s `VideoTranscoder`**
  — every generated `start`/`worker` task (and `zanix prepare --docker -p app`'s
  own `serve` task) now grants `--allow-run=ffmpeg,ffprobe` alongside the
  existing shared permission set (`RUN_PERMISSIONS`), inert unless a project's
  own code actually calls `transcode()`/`extractThumbnail()`. `zanix prepare
  --docker -p space|space-server`'s generated `Dockerfile` also provisions the
  `ffmpeg` binary itself, in both its build and runtime stages, immediately
  verified against the five real encoder capabilities
  (`libx264`/`aac`/`libvpx-vp9`/`libopus`/`libwebp`) `VideoTranscoder` depends
  on — failing the `docker build` itself, not silently, if any is missing. A
  bare Deno host/VM must still install the binary by hand; Deno Deploy can
  never run it (`Deno.Command` is disabled there). See
  [docs/deploy.md#media-transcoding](docs/deploy.md#media-transcoding).

### Changed

- **`.github/workflows/ci.yml` (the workflow `zanix prepare --github` writes, and `cli`'s own real
  workflow) now runs `deno fmt --check` and `deno lint`, each as its own step, before
  `zanix check-cycles`.** Previously the generated `ci.yml` only ran the circular-import-hazard
  check — nothing in the generated CI pipeline actually enforced formatting/lint on push or PR, so
  a project's real formatting/lint enforcement depended entirely on the opt-in, local `pre-commit`
  hook nobody is required to have installed. Every project type still gets `ci.yml`
  unconditionally; `publish.yml`'s own `publish` job is unaffected — it already only starts once
  `ci.yml` (now including these two new steps) succeeds. See
  [`docs/prepare.md`](./docs/prepare.md#-g---github).
- **`zanix generate interactor <name>` now also runs in a plain `space` project**,
  not just `server`/`space-server` — a `@zanix/space` app that owns no backend
  of its own but consumes a remote, typed Zanix API still needs a real `ZanixInteractor` in
  front of its own thin `RestClient` wrapper, the same shape `@zanix/console`'s
  own hand-authored `TriggersInteractor`/`TemplatesInteractor` already use in
  production. `server`/`space-server` are unaffected — the interactor still
  lands in the shared `interactors/` folder there. In a plain `space` project
  it lands in its own per-domain folder instead (`src/<name>/<name>.interactor.ts`,
  e.g. `zanix generate interactor triggers` → `src/triggers/triggers.interactor.ts`),
  matching the domain-named-folder shape `@zanix/console`'s own real
  interactors follow. `@zanix/server` is added to `imports` on demand via
  `ensureZanixDependency`, same as any other generator. Not seeded by
  `zanix new space`/`spacecraft` yet — a per-domain folder has no single fixed
  tree leaf for a Recipe entry to target, the same "no typed leaf published
  yet" gap `zanix generate component` already documents for `space`. See
  [`docs/generate.md`](./docs/generate.md#interactor).
- **`@zanix/validator`/`@zanix/types`'s declared version floor moved from `@zanix/utils@2.*` to
  `@zanix/utils@^3.0.1`** — `3.0.1` is the first published version with `classMetadata` (class-level
  RTO metadata introspection), which `zanix generate openapi`'s discovery step requires. A freshly
  generated/updated project now gets a `@zanix/utils@3.x` floor for these two subpath aliases.
  `@zanix/utils/logger`'s own pin is unchanged (`no-znx-console`'s auto-fix, the reason it was
  originally pinned, still hasn't published).
- **`@zanix/core`'s declared version floor moved from `^1.0.0` to `^2.0.0`, and `@zanix/datamaster`'s
  from `^1.0.0` to `^1.5.0`.** `@zanix/core@2.0.0` renamed `ConfigOptions.errorLogThrottle` to
  `ConfigOptions.errors.logThrottle` and moved its logger auto-detect/`ConfigOptions.notifications`
  onto `@zanix/datamaster`/`@zanix/notifications`'s own selector-based env-var renames
  (`SEARCH_ENGINE` instead of `ELASTICSEARCH_URL`/`OPENSEARCH_URL` presence,
  `notifications.templatesBackend` instead of `notifications.databaseTemplates`) — no dual-read
  compat shim on either side, so a `^1.0.0` floor never resolves into a real, currently-published
  `@zanix/core` release. `@zanix/datamaster@1.5.0` is the first published version carrying its half
  of that rename, so it's bumped in the same change. Every `server`/`space-server` project freshly
  scaffolded or updated via `zanix new`/`zanix generate` now gets these two floors. `cli` itself
  never emits `errorLogThrottle`/`ELASTICSEARCH_URL`/`OPENSEARCH_URL`/`databaseTemplates` in any
  generated template, so no generator/template output needed a shape change alongside this bump.

- **`zanix new space` / `space-server` now scaffold the renderer entry point.** `@zanix/space` no
  longer ships a renderer implementation (see that package's own entry-point split), so a generated
  `space.app.ts` installs one explicitly as its first import — `@zanix/space/react`, or
  `@zanix/space/preact` when `--renderer=preact` was passed. Both lines come from the CLI's existing
  `--renderer` flag: nothing inspects a project to guess its renderer, and
  `defineSpaceApp({ renderer })` stays the single declaration.
- **`zanix space dev`'s render probe no longer reads `@zanix/space`'s renderer registry.**
  `runRenderProbe` is now called without `renderPage`, so it uses whatever renderer the application
  itself installed. The previous `import { getPageRenderer } from '@zanix/space/dev'` is gone —
  that symbol is no longer public, and the CLI never chooses a renderer.
- Generated SSR handler shells now point at `@zanix/space/react` (or `/preact`) for
  `renderToResponse`, which moved out of `@zanix/space` with the same split. Every other generated
  import (`Page`, `SpacePageController`, `LayoutProps`, `ErrorBoundaryProps`, `defineComet`) is
  renderer-agnostic and unchanged.
- The `build`, `prepare` (Git/GitHub/editor scaffolding), and `new` project-tree
  implementation moved into this repo from `@zanix/utils` — this repo was
  already the only real consumer of that code. `@zanix/utils` no longer exports
  `compileAndObfuscate`, `prepareGithub`, `createVSCodeConfig`, `getZanixPaths`,
  `getAllZanixLibrariesInfo`, or the option types describing them.
- `zanix new server`'s handler/RTO/repository/seeder example files are now
  generated locally by this repo's own generator templates instead of being
  fetched over JSR from `@zanix/server`/`@zanix/datamaster`'s `src/templates/` —
  one source of truth per artifact shape.
- The project's own `CHANGELOG.md`/`LICENSE` moved from `docs/` to the repo
  root.
- **Breaking:** the installed binary is now `zanix` instead of `znx`. `znx` was
  never actually installable as a second alias (`CLI_ALIASES`'s `.alias()` on
  the root command had no effect on the OS `PATH` — only
  `deno install -n <name>` does, and only `znx` was ever installed). If you
  already have `znx` installed, run `deno uninstall -g znx` once, then reinstall
  with
  `deno install -A -g -n zanix https://jsr.io/@zanix/cli/[version]/.dist/app.mjs`.
- The publish workflow now syncs `src/installation/setup.sh`/`setup.ps1`'s
  fallback version with `deno.jsonc`'s real `version` before publishing, so the
  installer's default version can no longer drift out of date across releases.
- `toKebabCase`/`toPascalCase` moved out of this repo's own `utils/casing.ts` into
  `@zanix/utils`'s `helpers` module (see `@zanix/utils`'s own CHANGELOG) — they were
  fully generic string-casing primitives with zero CLI-specific logic, matching this
  repo's own documented split (`engineering.md` §3, "Config-split precedent") that
  generic, reusable primitives belong in `@zanix/utils`, not here. Every internal call
  site now imports them from `@zanix/helpers` instead; no behavior change (same
  regression tests, relocated to `@zanix/utils`, still pass unchanged).

### Removed

- **Breaking:** `zanix new` no longer scaffolds a `zanix/` folder
  (`config.ts`/`secrets.sqlite`). Both files were always generated empty
  (fetched from an `@zanix/core` `src/templates/` that has never had any content
  published), and nothing anywhere in the ecosystem reads them.
- **Breaking:** `zanix.hash` is no longer written to a generated project's
  `deno.json(c)`. It was only ever written and re-derived, never read by any
  real consumer — confirmed by an exhaustive audit across the whole ecosystem.
  Existing projects that already have `zanix.hash` in their config keep it as a
  static, inert value; it's no longer regenerated on later
  `zanix
  new`/`zanix prepare` runs.

### Fixed

- **`zanix space dev` now composes a consumer's own `preHandler` (e.g. `@zanix/space`'s
  `langPreHandler`), registered via `definePreHandler()`.** Previously, `preHandler` declared only
  in a project's own `mod.ts`/`bootstrapRemoteApp` call was invisible under `zanix space dev` —
  that command never imports `mod.ts`, only `space.app.ts`, and boots its own SSR server with a
  hardcoded, dev-only `preHandler` (Vite hot-client/dev-asset handling), with no composition hook.
  `getUserPreHandler()` (`@zanix/space`) is now read and tried AFTER those two, so a language
  redirect or any other custom `preHandler` behaves identically under `dev` and production.
- **`zanix space build` no longer overwrites a project's own hand-authored `messagesDir` ICU
  source when compiling it to AST.** `writeCompiledMessagesTree` used to write each compiled
  catalog back to the EXACT source path it read from — confirmed as a real bug, not a feature: an
  ordinary local `zanix space build` (not just a throwaway CI/deploy checkout, which is the common
  case, since most people build locally before pushing) silently replaced a developer's own
  readable ICU JSON with unreadable AST, with no way back short of reverting via version control.
  Compiled catalogs now land under `{outDir}/messages/{rootIndex}/...` (e.g.
  `.dist/client/messages/0/en/index.json`) — mirroring `messagesDir`'s own array order/index —
  alongside the client bundle's other manifests (`comets-manifest.json`, `assets/`, ...),
  following the exact same "compiled output lives in its own directory, source is never touched"
  contract `clientBuildDir` already establishes for those. `writeCompiledMessagesTree` gained a
  required `outDir` parameter; a new `writeCompiledCatalogs(result, dirs, outDir)` lets a caller
  compile + validate before a step that empties `outDir` (Vite's own `emptyOutDir: true`, which
  `zanix space build`'s own client bundle step uses) and write only after — `zanix space build`
  itself now does exactly that, straddling `buildSpaceClient()`. See `@zanix/space`'s own
  CHANGELOG for the matching `loadMessages()`/`getMessagesBuildDir()` read-side fix.
- **`zanix new space`/`zanix new app` no longer scaffold `src/shared/middlewares`** (the
  `@Guard`/`@Pipe`/`@Interceptor` examples). That subtree is REST-flavored — only meaningful for a
  project that actually boots the `'rest'` server type, which neither `space` (SSR-only,
  `bootstrapRemoteApp`/`Zanix.start()` only ever given `ssr`) nor `app` (composed by a consumer,
  never itself a running server) ever does; decorating anything with these examples in either
  registers a real REST controller that's structurally never served — dead code by construction.
  `server`/`space-server` (which DO boot `'rest'`) are unaffected. `getZnxFolderTree`
  (`commands/new/lib/tree/projects/main.ts`) was also refactored around this change: the
  project-type conditionals are now named "family" flags (`isServerFamily`/`isSpaceFamily`/...)
  computed once, instead of the same `type === 'a' || type === 'b' || isAll` comparisons repeated
  inline at each branch — no behavior change beyond the `space`/`app` fix above, purely
  maintainability as more types/subtrees get added over time.
- **`zanix prepare --docker`'s `space`/`space-server` Dockerfile no longer ships the whole project
  in its RUNTIME image.** The runtime stage used to `COPY . .`, same as the build stage above it —
  shipping `theme/` (build-time-only `globalCss` source), `messages/` (raw `messagesDir`, never
  read in production once `clientBuildDir` is set), `assets/` (raw `assetsDir` — already fully
  duplicated by `assetsPlugin`'s own build-time emit into `.dist/client/assets/`, which
  `AssetsRoute.serve()` already tries FIRST; a raw copy also broke the build outright for any
  project with no real `assetsDir` at all, since `COPY` has no "skip if missing" mode), `docs/`,
  `README.md`, `CHANGELOG.md`, `LICENSE`, and `src/@tests/`, none of which any runtime code path
  ever touches. Now copies only `src/` (`@zanix/space`'s SSR side runs directly against source, so
  this still ships raw), `deno.json(c)`/`deno.lock`, `mod.ts`/`space.app.ts`, and the compiled
  `.dist/client` output — see `docs/deploy.md`'s new "What the `space`/`space-server` runtime
  image actually ships" section for the full reasoning per excluded path, including when to add a
  `COPY assets ./assets` line back by hand. The BUILD stage is unaffected — it still needs the
  full source to run `zanix space build`.
- **The same Dockerfile's BUILD stage now runs this project's own `deno task build`
  (`zanix space build`, added to `baseZnxConfig`'s own `tasks` for `space`/`space-server`) instead
  of invoking `deno run -A jsr:@zanix/cli space build` directly** — one declared build command, not
  two independently-maintained copies that could drift apart (a flag added to the task but not the
  Dockerfile, or vice versa). The `zanix` binary itself isn't on PATH in a fresh `denoland/deno`
  image, so the build stage installs it globally first (`deno install -A -g -n zanix
  jsr:@zanix/cli` — the same command this package's own README documents for a real developer
  machine).
- **`zanix space dev`/`zanix space build` now warn when a project's own `"links"` override can't
  be honored, instead of silently ignoring it.** Both subcommands dynamically import the
  consuming project's own `space.app.ts` (via the shared `importSpaceApp`) — but Deno resolves
  that file's bare specifiers against `@zanix/cli`'s OWN `deno.jsonc`, not the project's, for the
  whole process. A project declaring `"links": ["../space"]` to test an unpublished local
  `@zanix/space` checkout got that override silently discarded whenever `@zanix/cli` itself ran
  from a local checkout (`deno run -A ../cli/mod.ts space dev`) — the real published package was
  used instead, with no indication anything went wrong, indistinguishable from "the fix doesn't
  work." A normal, `jsr:@zanix/cli`-installed `zanix` is unaffected (its entry module isn't
  local, so Deno already resolves via the project's own config). New
  `commands/space/shared/warn-unhonored-links.ts` (`warnUnhonoredProjectLinks`), wired into
  `importSpaceApp`, compares what the project's own `links` entries declare against what
  `import.meta.resolve` actually returns for each linked package's bare specifier, and prints a
  clear warning naming every mismatch before the import is attempted. Genuinely making the link
  take effect would require running the project's whole module graph in a separate process under
  a merged import map (the project's own overrides layered onto a rebased copy of `@zanix/cli`'s
  own) — disproportionate architecture for a local-CLI-development-only workflow — so a loud
  warning is the fix here, not silent, misleading behavior.

- **Running ANY `zanix` command — including a bare `deno install -A -g jsr:@zanix/cli` — no
  longer materializes every other command's own npm dependency tree.** `src/cli.ts`'s own graph
  (via `commands/mod.ts`'s eager barrel, needed for `--help`/tab-completion to work across the
  whole tool) previously reached `build`'s and `space`'s HEAVY action implementations as a pure
  side effect of merely registering their CLI surface: `esbuild`, `javascript-obfuscator`, `vite`,
  `@vitejs/plugin-react`, `@preact/preset-vite`, `react`, `preact`, `sharp`, `svgo`, `postcss`,
  `@tailwindcss/vite`, `@vanilla-extract/vite-plugin`, `graphql`, `mongoose`, `redis`, `amqplib` —
  1219 modules, confirmed via a real `deno info --json src/cli.ts` repro. A plain
  `zanix new`/`zanix generate` paid for `build`'s and
  `space`'s entire bundler/frontend/backend-connector dependency trees, and vice versa. Fixed by
  splitting each of `build`'s and `space`'s commands into a light CLI-surface file (unchanged
  `.command().description().option()` chain, still fully eager) and a separate, HEAVY action-
  implementation file resolved only once that specific subcommand actually fires, via a real,
  non-literal `await import(...)` — `commands/build/main.ts` (now lazy-loads
  `commands/build/lib/mod.ts`), and `commands/space/build/command.ts` / `commands/space/dev/
  command.ts` (now each a thin registration wrapper around a new sibling `action.ts` holding the
  real orchestration, unchanged otherwise). `deno info --json src/cli.ts` now resolves **395
  modules and 0 npm packages** — confirmed identically for every one of the 8 top-level commands
  checked in isolation (`new`, `prepare`, `build`, `generate`, `space`, `report-issue`,
  `check-cycles`, `credentials`), and confirmed that `build`'s/`space`'s own action files still
  correctly resolve their real heavy dependencies once actually invoked (full `deno test`
  suite green, including real live `zanix space build`/`zanix space dev` end-to-end boots).

- **`npm:esbuild@0.20.2`'s real, versioned specifier is now centralized** in a new
  `src/modules/lazy/specifiers.ts` (`ESBUILD_SPECIFIER`), matching the convention `@zanix/admin`/
  `@zanix/core` independently converged on the same day. `build-runner.ts`'s
  `await import('npm:esbuild@0.20.2')` — a literal string Deno's own static analyzer follows and
  materializes regardless of the `await import()` wrapper — now reads `await
  import(ESBUILD_SPECIFIER)` (non-literal), which is also what keeps `esbuild` out of `cli.ts`'s
  static graph now that `build-runner.ts` itself is only ever reached through the lazy
  action-handler seam above. `plugins/npm-modules.ts`'s `import type` and `typings.ts`'s two
  `import('npm:esbuild@0.20.2').<X>` references stay literal — TypeScript's own `import`/`import
  type` specifier can never reference a variable — but a new test
  (`esbuild-specifier-sync.test.ts`) now parses all three occurrences' own real source text and
  fails loud the moment a version bump touches one without the others. `obfuscate.ts`'s
  `await import('npm:javascript-obfuscator@^4.0.2')` got the identical non-literal treatment
  (`OBFUSCATOR_SPECIFIER`) for consistency, even though it had no duplicate occurrence to
  desync — as a side effect, `--obfuscate` itself is now lazy within an already-lazy `build`/
  `space build` action: `javascript-obfuscator` only resolves when that flag is actually used, not
  merely when `zanix build`/`zanix space build` runs at all.

- `zanix space build`'s own build pipeline (`@zanix/space/vite`, `@formatjs/icu-messageformat-
  parser`) was already free of the esbuild-shaped literal-duplication issue — its `vite`/
  `@deno/vite-plugin`-family dependencies are declared once each in `deno.jsonc`'s own `imports`
  map, with no second, hand-duplicated version string anywhere in `cli`'s own source. No further
  action needed there beyond the lazy-loading restructure above.

- **`zanix generate job`'s scaffolded `registerJob`/`registerCronJob` import** now targets
  `@zanix/asyncmq/jobs` instead of the bare `@zanix/asyncmq` root — `@zanix/asyncmq@0.8.0` moved
  job/cron registration to that narrow subpath (no RabbitMQ connector) and no longer re-exports it
  from root. `zanix generate subscriber`/`dlqprocessor` are unaffected (`Subscriber`/
  `ZanixSubscriber`/`MessageInfo` stay at the root; `registerDLQProcessor` already imported from
  `@zanix/asyncmq/dlq`).

- **`zanix generate handler --type graphql`'s scaffolded resolver** now imports
  `ZanixResolver`/`Resolver`/`Query` from `@zanix/server/graphql` instead of the bare `@zanix/server`
  root — `@zanix/server@4.0.0` moves `ZanixResolver`/`Resolver`/`Query`/`Mutation`/`Request` to that
  subpath and no longer re-exports them from root. `HandlerContext` is unaffected — it stays a root
  import, shared by every handler kind. `ensureZanixDependency` now also declares
  `@zanix/server/graphql` (on top of the plain `@zanix/server` every handler type already declares)
  when `--type graphql` is used.

- **`zanix new library`'s `mod.ts`/`src/modules/mod.ts` no longer fetch a live placeholder from
  `@zanix/utils`'s own `src/templates/` over JSR — both are now generated locally, the same
  "own the content, don't fetch another package's source" rule already applied to every other
  `zanix new`/`zanix generate` leaf (`docs/engineering.md` §5).** `@zanix/utils@4.0.0` removes its
  own root `mod.ts`/`"."` export entirely (an unrelated, real breaking change on that repo's own
  side) — the fetched `src/templates/` files this scaffold pulled from are a separate, still-served
  path unaffected by that specific removal, but the underlying coupling was real regardless: a
  brand-new library's starter content silently tracked whatever `@zanix/utils`'s own
  `src/templates/mod.ts`/`src/templates/src/modules/mod.ts` happened to contain (a hardcoded
  `auth`-named example, never meant as a generic placeholder for every future `zanix new library`
  invocation), with no cross-check and no local ownership — exactly the drift pattern already
  retired for `handler`/`rto`/`repository`/`seeder`/`connector`/`interactor`/`job`/`middleware`.
  `library.ts` now exports `getLibraryRootModTemplate` (the real, published root `mod.ts`,
  re-exporting `src/modules/mod.ts`) and `getLibraryModTemplate` (a real, dependency-free starter
  module), both wired through the same `ScaffoldRecipeEntry`/`assembleScaffold` mechanism
  `app`/`server`/`space` already use for their own root-level artifacts — `library` is no longer a
  structurally distinct case, just a recipe with no second preset of its own yet.
  `commons.ts`'s shared root tree no longer special-cases `library` at all (it used to conditionally
  push `MAIN_MODULE` onto the same JSR-fetched `mainFiles` list); `getZnxFolderTree` (`main.ts`)
  appends `library`'s own root `mod.ts` afterward instead, the identical push-after-`getCommonTree`
  shape `server`/`space`'s own root `mod.ts` already use.
- **`zanix new space/spacecraft`'s own actions called `createFilesAndFolders(structure, template)`
  — passing `--template`'s own value (the PRESET) where `createFilesAndFolders` actually expects
  the literal `'base'`, the one and only key `ZanixTemplatesRecord` (`@zanix/types`) ever has,
  regardless of which preset built a tree's content.** The two values were always identical by
  coincidence, as long as `'base'` was the only preset that existed — confirmed a real, previously
  dormant bug the moment `'welcome'` made them diverge for the first time:
  `createFilesAndFolders(structure, 'welcome')` would have looked up
  `structure.templates?.['welcome']` (always `undefined`, on every node, since `assembleScaffold`
  always writes onto `.base`) and silently written NOTHING anywhere in the tree — a completely
  empty project, no error, `zanix new` still exiting `0`. Fixed in `new/actions/space.ts`/
  `spacecraft.ts`: this call now always passes the literal `'base'`; `getZanixPaths`/
  `ensureSpaceScaffoldSideEffects` still receive the real preset value unchanged. The identical
  latent pattern exists in `app.ts`/`server.ts`/`library.ts` too (dormant — none of those three has
  a second preset yet), tracked separately rather than fixed here.
- **`importSpaceApp` (`zanix space build`/`zanix space dev`) stopped recognizing a real,
  correctly-authored `space.app.ts` — `'space.app.ts' must have a default export from
  defineSpaceApp()'` on a project that plainly had one.** Root cause: `cli`'s own `deno.jsonc` was
  bumped to `jsr:@zanix/app@^0.2.0` (resolved, via the new `"links"` config field, to the local
  `../app` checkout), while `@zanix/space` — still consumed by `cli` through a local relative path
  (`../space/mod.ts`, unpublished) — kept its own `@zanix/app` pin at `^0.1.0` in its own
  `deno.jsonc`. Deno only honors a package's own `"links"` field at the workspace root (confirmed
  via `deno info`'s own warning: `"links" field can only be specified in the workspace root
  deno.json file`), so `@zanix/space`'s `defineSpaceApp()` kept building on a real, separately
  jsr.io-fetched `@zanix/app@0.1.0` instead of the linked local checkout — a second, distinct module
  instance of `@zanix/app`, with its own `ZANIX_APP_DEFINITION_BRAND` `Symbol`, that `cli`'s own
  `isZanixAppDefinition` (built on the linked `0.2.0` copy) could never recognize as the same brand.
  Fixed at the root: bumped `@zanix/space`'s own `@zanix/app`/`@zanix/app/runtime` pins to
  `^0.2.0` too (`space/deno.jsonc`) — matching `@zanix/app@0.2.0`'s own changelog (no breaking
  change for anything either package uses) and the rest of the ecosystem (`admin`, `core` already
  pin `^0.2.0`) — so both `cli` and `@zanix/space` now resolve `@zanix/app` to the exact same linked
  local module, sharing one brand `Symbol` again. `cli`'s own `deno.lock` picked up the unified
  `jsr:@zanix/app@0.2` resolution automatically.
- **`server`/`space-server` projects no longer get a dead `@zanix/types` entry declared in their
  generated `deno.json`, and `zanix generate rto` no longer `ensureZanixDependency`'s it either.**
  `@zanix/types` was only ever pulled in by `rto`'s hand-rolled `IsPermission.ts` local validator
  (`import type { ValidationOptions } from '@zanix/types'`); once that file was removed (`objectId`
  now renders a real `@zanix/validator` decorator, `permission` a plain `IsString` — see
  `rto/renderer.ts`'s own doc), nothing this package generates imports `@zanix/types` anymore —
  audited across every generator (`handler`, `component`, `page`, `comet`, `connector`,
  `middleware`, `subscriber`, `job`, `dlqprocessor`, `repository`, `interactor`, `rto`, and every
  `zanix new` project type), not just `rto`. `PROJECT_TYPE_DEPENDENCIES.server`/`.space-server`
  (`utils/config/dependencies.ts`) and `rto/command.ts`'s unconditional `ensureZanixDependency`
  call are updated accordingly; `ZANIX_DEPENDENCY_VERSIONS['@zanix/types']` itself stays declared
  (a real, valid alias into `@zanix/utils`'s own `/types` subpath — kept ready for a future field
  type/generator, same as the not-yet-published `@zanix/app`/`@zanix/space` entries).
- **`zanix new server <name>`'s default scaffold no longer generates a `handlers/rtos/
  example.rto.ts` that fails `deno fmt --check`.** `renderer.ts`'s `rtoTemplate` builds each of its
  4 classes (`Search`/`Get`/create/`Edit`) as `export class <Name>RTO extends BaseRTO {\n${
  renderClassBody(fields)}\n}` — `renderClassBody([])` returns `''` for a class with zero fields,
  but the template literal's own fixed newlines around it still left a literal blank line between
  `{` and `}`. Only the create class (`${pascalName}RTO`, built from the raw, user-supplied
  `fields` with no synthetic field always added) can actually hit zero fields; `Search`/`Get`/
  `Edit` always render a synthetic `QUERY_FIELD`/`ID_FIELD`. `zanix new server`'s own default
  scaffold calls `planRto('example', 'Example', [], folder)` — an empty `fields` array — hitting
  this 100% deterministically (confirmed with a real `zanix new server <name> --no-prepare` +
  `deno fmt --check`). A new `renderClass` helper renders every one of the 4 class declarations
  through one consistent path, emitting the already-`deno fmt`-clean `{\n}` (no blank line)
  when a class has zero fields and the existing `{\n${body}\n}` shape otherwise; a non-empty class
  is byte-for-byte unaffected.
- **`zanix generate page <route-path>` (and `zanix new space`/`spacecraft`'s own initial page,
  which shares the exact same `pageTemplate`) no longer generates a page that fails the generated
  project's own `deno-zanix-plugin/require-access-modifier` lint rule.** The scaffolded `static
  head`/`component` class members carried no explicit access modifier — confirmed with a real
  `deno lint` on a freshly generated project (2 violations, `deno lint --fix` does not resolve
  either one; the rule has no auto-fix) — while `SpacePageController`'s own real, published
  declarations (`@zanix/space`) are both `public`. Both members now carry `public`; `head`
  additionally needs `override` (`SpacePageController.head` is a concrete, non-abstract member, so
  the generated project's own `strict: true` compiler option rejects overriding it without the
  keyword — confirmed with a real `deno check` against `@zanix/space`'s own source, not assumed;
  `component` implements an `abstract` member, which TypeScript never requires `override` for, but
  keeps the keyword anyway, matching every real page fixture in `@zanix/space`'s own test suite).
  `zanix new spacecraft` needed no separate fix — it seeds its initial page through the same
  `planPage`/`pageTemplate` `space.ts` tree leaf, not a hand-written copy.
- **The `setup.sh`/`setup.ps1` one-liner installers (`curl | sh` / `irm | iex`, see
  [`README.md`](./README.md#installation)) no longer print `🎉 Installation completed!` after a
  real failure.** Neither script checked the exit code of its three meaningful steps — installing
  Deno, installing `zanix` itself via `deno install`, and the post-install smoke test that runs the
  freshly installed binary — so a failed network fetch, a `deno install` error (bad version,
  registry outage, ...), or a broken installed binary all fell straight through to the unconditional
  success banner with exit code `0`. Both scripts now check each step explicitly (`setup.sh`: an
  explicit `|| { ...; exit 1; }` per step — deliberately not a blanket `set -e`/`set -o pipefail`,
  since the two existing `read -p` confirmation branches rely on a non-zero `command -v` as a
  legitimate branch, and `pipefail` isn't POSIX while README.md documents running this file via a
  plain `sh`; the Deno install itself is now a download-then-run pair instead of `curl | sh`, so
  the download failing and the installer itself failing get distinct messages without needing
  `pipefail` either way. `setup.ps1`: a `try`/`catch` around the cmdlet-based `irm | iex` Deno
  install — verified with `$ErrorActionPreference = 'Stop'`, since external processes don't throw
  — plus `$LASTEXITCODE` checks after the two native-executable steps, `deno install` and the
  smoke test) and now exit non-zero with a specific `error[zanix-installer]: ...` message naming
  which step failed before the success banner is ever reached. The happy path is unchanged: each
  step's output is still captured and discarded on success, only surfaced when that step actually
  fails.
- **`zanix new <type> <name>` rejects a `..` path-traversal segment in `<name>` instead of writing
  through it.** `<name>` used to reach the generated project's directory path with no validation at
  all — a name like `../../etc/cron.d/evil` (plausible from an automated/scripted caller of this
  CLI — a wrapper tool, a web-based generator UI — not only a human typing it interactively) could
  write the new project's files outside the intended directory, up to the filesystem root. A plain
  leaf name, a nested relative path, and an absolute path remain fully supported (the new check,
  `assertSafeProjectName` in `utils/projects/validate-name.ts`, only rejects an actual `..`
  segment) — every `new` action already routes this failure through the same `this.throw` an
  unknown `--template`/`--renderer` value does, before anything is written.
- `deno lint`'s own `@zanix/utils` plugin (`deno-zanix-plugin`) is now version-pinned
  (`^2.6.1`), matching every other `@zanix/utils` import in `deno.jsonc` — it used to resolve
  unpinned, so a lint run could silently pick up a newer, unreviewed plugin version.
- **`zanix generate <artifact> <name>` rejects a `..` path-traversal segment in `<name>` instead of
  writing through it** — the same fix `zanix new <type> <name>` already got, applied to every
  `<name>`-taking generator (`comet`, `component`, `connector`, `dlqprocessor`, `handler`,
  `interactor`, `job`, `middleware`, `repository`, `rto`, `seeder`, `subscriber`). `<name>` used to
  reach the generated file's path with no validation at all — a name like `../../../../victim`
  could write outside the target project. Routes through the same `this.throw` an unsupported
  `--type`/`--kind`/`--slot` already does, before anything is written
- **`zanix new <type> <name>`'s generated `LICENSE` no longer leaves `[YEAR]` unfilled.**
  `@zanix/utils`'s own shared `src/templates/LICENSE` (`Copyright (c) [YEAR] [ORGANIZATION]`,
  fetched byte-for-byte via `createFilesAndFolders` for every project type — `commons.ts`'s
  `getCommonTree` seeds it at the root regardless of `library`/`server`/`space`/`spacecraft`/`app`)
  used to be written verbatim, with `[YEAR]` never substituted — confirmed real: `@zanix/admin`'s
  own generated `LICENSE` had this exact unfilled placeholder until fixed there by hand. A new
  `fillLicenseYear` (`utils/projects/creation.ts`) fills `[YEAR]` with the real current calendar
  year right before writing — the one part of the placeholder `zanix new` can actually know, same
  asymmetry `baseZnxConfig`'s own `@your-scope` package-name derivation already follows.
  `[ORGANIZATION]` is deliberately left untouched — the CLI can never know a user's real copyright
  holder, and it must never be guessed from the project name, a JSR scope, or a GitHub org slug
  (this ecosystem's own real `LICENSE` files say `ZANIX`, a distinct thing from the GitHub org
  `zanix-io`).
  (`assertSafeGeneratorName` in `commands/generate/shared/safe-name.ts`, wrapping the existing
  `assertSafeProjectName`). The four `<route-path>`-taking generators (`page`/`layout`/`error`/
  `loading`) get the same protection via a dedicated sibling, `assertSafeGeneratorRoutePath` — it
  still rejects any `..` segment (e.g. `'../../../../victim'`) but, unlike `assertSafeGeneratorName`,
  allows an empty route path, since `''` legitimately addresses the app's root route/root layout for
  these four generators (`assertSafeProjectName` itself now takes an optional
  `{ allowEmpty: true }`, defaulting to `false` — every existing `zanix new`/`assertSafeGeneratorName`
  caller is unaffected).
- **`zanix generate <artifact> <name>` rejects a `<name>` that derives into an invalid TypeScript
  identifier instead of silently writing invalid source.** Every `<name>`-taking generator
  (`comet`, `component`, `connector`, `handler`, `interactor`, `middleware`, `repository`, `rto`,
  `subscriber`) derives a PascalCase identifier via `toPascalCase(name)` and emits it straight into
  `export class <PascalName>`/`export function`-shaped generated code — `assertSafeGeneratorName`
  only ever guarded the raw `name` against path traversal, so a leading-digit name (e.g. `zanix
  generate handler 123entity`) survived `toPascalCase` untouched and was written as-is, producing
  code that doesn't compile with zero warning. A new `assertValidIdentifier` (`commands/generate/
  shared/valid-identifier.ts`) checks the derived PascalCase name against a real JS/TS identifier
  shape (`/^[A-Za-z_$][A-Za-z0-9_$]*$/`) immediately after `toPascalCase` runs, before it's used for
  planning or file content — this also naturally catches an all-punctuation `name` (e.g. `'---'`)
  that collapses to an empty string, not only the leading-digit case. Routes through the same
  `this.throw` every other generator guard already uses; a normal name (e.g. `'my-entity'`) is
  completely unaffected.
- **`zanix generate rto <name> --field <spec>` rejects two `--field` flags that share the same
  field name instead of silently writing a duplicate class member.** `parser.ts`'s `parseFields`
  used to map every `--field` spec through `parseFieldSpec` with no check across the resulting
  list — since each field's `name` becomes one `accessor <name>: ...` on the generated RTO class
  (`renderer.ts`), a spec like `--field total:number --field total:string` wrote a `.rto.ts` with
  two `accessor total: ...` declarations in the same class: invalid TypeScript, with zero warning
  at generation time. `parseFields` now detects any `name` that appears more than once across the
  parsed fields and throws a clear error naming each duplicated field and how many times it
  appeared (e.g. `Duplicate --field name(s): 'total' (given 2 times).`), routed through the same
  `this.throw` this generator's other guards already use — before anything is written. A field set
  with all-unique names is unaffected.
- **`zanix prepare -d/--docker` and `-g/--github` reject an invalid `--project-type` instead of
  silently warn-and-skipping like a legitimate "this project type has nothing to generate here"
  case.** The shared `--project-type` flag both consumers accept used to go straight from
  `options.projectType as ZanixProjects` to `prepareDocker`/`prepareGithub` with no runtime check —
  a real typo (e.g. `--project-type foobra`) was indistinguishable from `docker-file.ts`'s own
  documented `'library'` skip (no `Dockerfile` template) or `publish.ts`'s own documented
  non-`'library'`/`'app'` skip (no publish workflow): both took the same warn-and-continue path,
  exit 0. For `--docker` specifically this also produced partial output — `.dockerignore` written
  unconditionally, `Dockerfile` silently not. A new shared guard,
  `assertValidProjectType` in `commands/prepare/shared/project-type.ts`, checks the raw flag
  against the real `ZanixProjects` union (`'library' | 'server' | 'space' | 'space-server' |
  'app'`) before either action does anything else, and throws through the same `this.throw` an
  invalid `--hooks-engine` already does. `undefined` (the flag being omitted) is still valid — each
  downstream consumer keeps its own default.
- **`zanix new <type> <name>` no longer silently writes 0-byte files and reports success when it
  can't actually reach JSR/Shields.io.** Three cascading swallow points used to turn a failed
  template-content fetch (no network, a non-OK HTTP response, JSR down) into an empty string that
  `createFilesAndFolders` then wrote straight to disk, all while the command still logged "created
  successfully" and exited 0:
  - `readFileFromCurrentUrl` (`utils/read-current-file.ts`) now throws — naming the URL and the
    real HTTP status — instead of returning `''` for a non-OK response.
  - `getZanixTemplateContent` (`commands/new/lib/tree/templates.ts`) no longer has a
    `.catch(() => '')` around that call; the rejection now reaches its own caller.
  - `getShieldsDataVersion` (`commands/new/lib/tree/info.ts`) no longer has either of its two
    silent fallbacks to the literal string `'latest'` (one for an unexpected Shields.io response,
    one in an outer `.catch` for any thrown exception) — confirmed empirically that `'latest'`
    never actually worked as a substitute anyway (`https://jsr.io/<lib>/latest/<file>` 404s; JSR's
    real file-serving URLs require an actual semver segment), so the fallback only deferred the
    failure to the swallow point above instead of avoiding it.
  - Fixing the above surfaced a second, deeper problem: `getAllZanixLibrariesInfo` eagerly resolves
    all nine `ZanixLibraries` versions in one `Promise.all`, but `getZanixTemplateContent` (its
    only real consumer) only ever needs ONE of them per call — at the time of this fix, only
    `'@zanix/utils'` (`commons.ts`/`library.ts`) and `'@zanix/core'` (`projects/main.ts`'s shared
    `pipe.defs.ts`/`interceptor.defs.ts`) were ever requested anywhere in the `new` project tree,
    never both at once (the `'@zanix/core'` requester was itself retired later in this same
    `[Unreleased]` section — see the "Resolved" entry below). With the `'latest'` fallback gone, an
    unrelated library that can't be
    resolved at all would have broken every single `zanix new` invocation — empirically confirmed
    for `'@zanix/worker'`, not yet published on JSR (Shields.io's own badge response for it is the
    literal text `"package not found"`). A new `getZanixLibraryVersion` (`info.ts`), memoized per
    library and never caching a rejection, resolves exactly the one library a call needs instead;
    `getAllZanixLibrariesInfo` itself is untouched (still throws hard on any unresolved library)
    for a future consumer that genuinely needs all nine at once.
  - **Resolved (was previously flagged here as an external, out-of-scope follow-up — it wasn't):**
    the swallow-point fix above made it loud, for the first time, that `zanix new server`/`app`/
    `space`/`spacecraft` (every type except `library`) had been requesting
    `@zanix/core`'s `src/templates/middlewares/{pipe,interceptor}.defs.ts` — a path that, verified
    directly, has never actually existed (`https://jsr.io/@zanix/core/1.1.0/src/templates/
    middlewares/pipe.defs.ts` 404s, and `@zanix/core`'s own local checkout's `src/templates/` is
    empty too), meaning every prior `zanix new server`/`app`/`space`/`spacecraft` invocation had
    ALREADY been silently writing a 0-byte `pipe.defs.ts`/`interceptor.defs.ts`. This was
    mischaracterized as blocked on an external `@zanix/core` publish; it wasn't — `middleware` had
    its own `zanix generate` generator (`planMiddleware`) the whole time, the exact ownership
    boundary `docs/engineering.md` §5 already established for `handler`/`rto`/`repository`/
    `seeder`/`connector`/`interactor`/`job`, just never applied to this one leftover leaf.
    `src/commands/new/lib/tree/projects/main.ts` now generates both example middleware shells
    locally via `planMiddleware`, the same way every other migrated leaf does — no JSR fetch, no
    dependency on `@zanix/core` ever publishing anything. Generated filenames changed accordingly:
    `example.pipe.ts`/`example.interceptor.ts` (matching `zanix generate middleware`'s own
    `<name>.<kind>.ts` convention) instead of `pipe.defs.ts`/`interceptor.defs.ts`.
  - **Resolved (was previously flagged here as a known, deliberately-unfixed test failure — now
    actually removed):** `getAllZanixLibrariesInfo` (`info.ts`) — the all-nine-libraries batch
    lookup `zanix-tree-jsr-fetch.test.ts`'s own direct test exercised — had zero real consumers
    (`getZanixTemplateContent`, its only real former caller, was already migrated to the
    one-library-at-a-time `getZanixLibraryVersion` above) and could never pass while
    `'@zanix/worker'` stays unpublished on JSR — a phantom entry inherited from `ZanixLibraries`
    (`@zanix/utils`'s own type; not owned by `cli`), not a real package. Deleted the function, its
    module-level `ZNX_LIBRARIES` cache, and the failing test alongside it, rather than patch around
    a package that will likely never publish under that name.
  - `newServerAction`/`newAppAction`/`newSpaceAction`/`newSpacecraftAction`/`newLibraryAction`
    needed no additional try/catch: each is already an `async function` with no local try/catch
    around its `createFilesAndFolders` call, and a plain uncaught `await` inside one always rejects
    the function's own returned promise — Cliffy's own `parseCommand` already awaits the action
    inside a try/catch that routes any rejection through `this.throw` → this repo's own
    `errorHandlerFn` (`cli.ts`'s `setErrorHandler`) → `Deno.exit(1)`, confirmed empirically via a
    real `deno run --deny-net=jsr.io,img.shields.io` subprocess (see
    `commands.new.test.ts`'s new regression test).
- **`zanix new <type> <name> --verify` no longer always reports verification failure, even for a
  genuinely valid, freshly-generated project.** `verifyGeneratedProject` (`utils/verify.ts`)
  collected every file to check via `join(root, ...)`, then spawned the `deno check` subprocess
  with `cwd: root` and those SAME (still relative, whenever `root` itself was relative — the
  common case, since `<name>` is normally a plain leaf like `'my-zanix-server'`) paths as its
  `args`. The child process resolved those already-relative args a SECOND time against its own
  `cwd` (= `root`), doubling the leaf segment (e.g. `'my-zanix-server/mod.ts'` becoming
  `'my-zanix-server/my-zanix-server/mod.ts'`) and failing every file with a false "Cannot find
  module" — indistinguishable from a real compile error without reading the raw path in stderr.
  `verifyGeneratedProject` now resolves `root` to an absolute path (`@std/path`'s `resolve`) up
  front, before collecting files or spawning the subprocess — idempotent, a no-op for a caller that
  already passed an absolute `root`. All five `new/actions/*.ts` callers
  (`server`/`app`/`space`/`spacecraft`/`library`) share this one fix. A genuine compile error in
  the generated project is still correctly reported (this removes a false failure, it doesn't
  disable real failure detection).
- **`zanix generate job/dlqprocessor/subscriber/connector` no longer let an unescaped `'` (or a
  literal `*/` inside a JSDoc comment) in free-text input break out of the generated file's own
  string literal / comment and inject arbitrary statements that execute the moment a real app
  imports it.** Six string-literal interpolation sites — `job`'s `jobName`/`cronExpression`
  (`name: '...'`/`schedule: '...'`), `dlqprocessor`'s `kebabName`/`processType`/`schedule`
  (`name: '...'`/`registerDLQProcessor('...'`/`schedule: '...'`), `subscriber`'s `queue`
  (`@Subscriber('...')`), and `connector`'s `slot` in `cache.template.ts`
  (`@Connector({ slot: '...' })`) — interpolated their value straight into a single-quoted string
  literal with zero escaping; a value containing a `'` (e.g. `--cron "0 0 * * *'; console.log
  ('pwned'); //"`) closed the literal early and turned the rest of the payload into live,
  executable TypeScript, confirmed with a real `deno run` of a generated file. A new shared
  helper, `escapeTsStringLiteral` (`commands/generate/shared/escape-template-string.ts`), escapes
  `\`, `'`, and every raw JS line terminator (`\n`, `\r`, U+2028, U+2029) before each of those six
  values is embedded, so the original value always round-trips back as inert string content.
  `cache.template.ts`'s `slot` also appears a second time on a JSDoc comment line
  (`* Cache connector for X, registered under the '<slot>' core slot.`) — a different failure mode
  a `*/` in the value closes the comment block early instead, letting the JSDoc's own remaining
  lines and the `@Connector(...)` decorator right below it parse as live code — fixed by a second
  helper in the same file, `escapeJsDocCommentText`, which breaks up any `*/` sequence in the
  value so it can't terminate the comment. `pascalName`-shaped values (class names) are
  deliberately untouched — those already route through `assertValidIdentifier`. An ordinary value
  with no special characters is unaffected in every case.
- **`zanix prepare -g/--github` no longer surfaces a raw `Deno.errors.NotFound` instead of its own
  documented "pre-commit isn't installed" warning when the `pre-commit` binary is genuinely absent
  from `PATH`.** `createPreCommitYaml`'s `pre-commit install` shell-out
  (`commands/prepare/lib/github/files/pre-commit-config.ts`) only ever checked
  `install.success` — accurate for a _successful spawn_ that then exits non-zero, but a binary
  missing from `PATH` entirely makes the spawn itself reject (`Deno.errors.NotFound`), which
  propagated uncaught straight through `prepareGithub`'s own `Promise.all` (confirmed via a real
  `PATH` override and a `Deno.Command`-stubbed subprocess run both before and after this fix): the
  whole array rejected early, so `createPreCommitHook`/`createPrePushHook` — running concurrently
  in that same array — never got the chance to report their own real result. The spawn is now
  wrapped in its own `try`/`catch`: `Deno.errors.NotFound` specifically now logs the existing
  friendly "It seems pre-commit is not installed..." warning (the accurate message for this exact
  cause), while any OTHER unexpected spawn failure (e.g. permission denied) logs a distinct
  warning naming the real error instead — "install pre-commit" isn't the right advice for a
  different underlying problem. Neither case throws; `.pre-commit-config.yaml` is still written
  either way, matching the function's own pre-existing doc claim. `pre-commit autoupdate`'s own
  discarded result is untouched — a separate, smaller gap than what this finding covers.
- **`zanix new space`/`spacecraft --icons` no longer leaves a partial, half-configured project
  behind when the icon-catalog side effect fails.** `newSpaceAction`/`newSpacecraftAction` called
  `ensureSpaceScaffoldSideEffects` (which runs `copyIconCatalog` when `--icons` is set) BEFORE
  `saveZanixConfig` — a thrown `copyIconCatalog` (today, 100% of the time: `resolveSpaceUiVersion`
  deliberately gates on `@zanix/space-ui` not yet being a published JSR dependency; in general, any
  real network/fetch/write error) took the whole action down with it, leaving real files on disk
  but no `saveZanixConfig` ever having run — no `zanix` section in `deno.json`, no explanation
  beyond a raw thrown error. `--icons` is architecturally optional/additive, so
  `ensureSpaceScaffoldSideEffects` now wraps its `copyIconCatalog` call in its own try/catch: on
  failure it logs a `logger.warn(..., 'noSave')` naming the real underlying error, then lets the
  rest of the scaffold (`saveZanixConfig`, `--verify`, `--prepare`) complete exactly as if
  `--icons` had never been passed — graceful degradation, never a rollback of anything else the
  CLI already wrote. `copyIconCatalog` itself is unchanged in its own throw-on-failure contract
  (still directly tested to do so); it now additionally cleans up any of ITS OWN partial output
  (`assets/icons/`, `src/space/catalog-icon.ts` — nothing else) via a best-effort
  `cleanupIconCatalogOutput` before rethrowing, since its two internal writes
  (`writeIconCatalogFiles`'s 3 concurrent `Deno.writeTextFile` calls, then
  `writeCatalogIconWrapper`) can otherwise leave a confusing subset written on a failure partway
  through — a real risk for any future failure point inside `copyIconCatalog`, not just today's
  gate (which fails before any I/O, so nothing to clean up in practice yet).
- **`zanix new <type> <name>`'s generated `deno.json` no longer fails `deno publish --dry-run` on
  every project with a `missing 'version' field` error.** `baseZnxConfig` never wrote a `version`
  field at all, for any project type — confirmed with a real `zanix new library`/`zanix new app`
  followed by `deno publish --dry-run`: JSR requires the field at publish time even though
  `ConfigFile['version']` itself is optional. Every project type's `deno.json` now gets
  `version: '0.1.0'` (`INITIAL_PROJECT_VERSION` in `utils/config/base.ts`) — the common Deno/JSR
  "first version" convention, confirmed against `@zanix/space`'s own real, still-early `deno.json`
  — written unconditionally, not only for `library`/`app` (the two types that also get a `publish`
  block), so a `deno.json`'s shape never depends on project type for this one field. Separately,
  the generated `name` field's hardcoded `'@project/name'` — a forgotten literal, never derived
  from anything, and one that looked deceptively like it could already be real — is now
  `` `@your-scope/<real-project-name>` ``: the package-name half is the actual project name
  (`getFolderName` on the same `root` value `saveZanixConfig` already receives), while the scope
  half stays an unmistakable placeholder, since no `zanix new`/`zanix generate` invocation can ever
  know a user's real, owned JSR scope — that half will always need hand-editing before a real
  `deno publish`, with or without this fix.
- **`zanix new app <name>`'s generated `mod.ts` no longer violates its own scaffolded lint rules.**
  `getAppModTemplate` used to write `console.log(...)` inside `onStart` — a real `no-znx-console`
  violation confirmed via `deno lint` on a fresh `zanix new app` (`@zanix/utils`'s rule has no
  `fix` function, so `deno lint --fix` — what the installed pre-commit hook runs — genuinely could
  not resolve it) — and a bare `export default defineZanixApp({...})`, which trips JSR's
  `unsupported-default-export-expr` slow-types check at `deno publish` time (confirmed via
  `deno publish --dry-run`, no `--allow-slow-types`, same repro B1 already hit on this exact file).
  `mod.ts` now imports the real Zanix logger (`import logger from '@zanix/utils/logger'`) instead
  of `console`, and its default export is explicitly typed via `defineZanixApp({...}) as
  ZanixAppDefinition` — confirmed empirically (not merely assumed) to satisfy the fast-check
  analyzer without `--allow-slow-types`. `app`'s `PROJECT_TYPE_DEPENDENCIES` entry now also
  declares `@zanix/utils/logger` (`jsr:@zanix/utils@2.*/logger`, the same subpath-alias convention
  `@zanix/validator`/`@zanix/types` already use), so the new import resolves in the generated
  project's own `deno.json` instead of failing `deno check`.
- **`zanix prepare -g/--github`'s generated `.github/workflows/publish.yml` no longer publishes a
  real package to JSR from an open, unmerged pull request.** The `publish` job runs on both
  `pull_request` and `push` to the main branch (needed so tests run on a PR too), but the `Publish
  to Deno` step had no `if:` condition at all, so `deno publish` unconditionally ran on every PR
  event as well — confirmed as a real, already-triggered incident across every published Zanix
  repo, each fixed by hand in its own `.github/workflows/publish.yml` ahead of this template fix.
  The step now carries `if: success() && github.event_name == 'push'` — `github.event_name ==
  'push'` restricts it to an actual push (never an open PR); the explicit `success() &&` is
  required alongside it, not redundant, because GitHub Actions only applies its implicit
  `if: success()` when a step has no `if:` of its own — writing any `if:` replaces that default
  instead of adding to it, so without `success() &&` a failed `Run tests` step on a real push to
  the main branch would no longer block `deno publish`. `zanix prepare`'s own `--project-type
  library`/`app` (the only two project types that get this workflow at all) both share this one
  template file (`publish.base.yml`), so both are fixed by the same change.

- `zanix space dev` now composes `spacePlugin({ renderer: getActiveRenderer() })` instead of
  `spacePlugin()` — a project declaring `defineSpaceApp({ renderer: 'preact' })` in its own
  `space.app.ts` previously still got served through React's Vite plugin, since
  `getActiveRenderer()` wasn't public yet and `@zanix/space`'s own active-renderer flag only
  resolved once `setup()` ran (inside `activateApps()`, called AFTER this plugin composition).
  `zanix space build` needed no code change — `buildSpaceClient`'s own `renderer` option now
  defaults to `getActiveRenderer()` internally (see `@zanix/space`'s own CHANGELOG), and this
  command already imports `space.app.ts` before calling it.
- `zanix generate` (with no artifact) silently produced no output at all —
  neither help nor an error — unlike `zanix new`/`zanix prepare`, which both
  already guarded this case. Now shows usage and a clear error.
- Every `zanix generate <artifact>` and `zanix new <type>` action failed to
  `await`/`return` its own async work before considering the command "done" —
  harmless in practice (Deno keeps the process alive until pending promises
  settle) but fragile, and it meant `zanix new`'s automatic `prepare` step could
  in principle start running before the scaffold it depends on had finished
  writing. Now properly chained.
- `getCommonTree`'s memoization cache key was `root` alone, ignoring the
  project `type` — scaffolding two different project types into the same path
  in one process (e.g. running two project-type builders back-to-back against
  the same directory) silently returned the first call's stale tree, producing
  a duplicate `mod.ts` entry. The cache key now includes `type`, matching the
  `${startingPoint}::${preset}` convention `getServerSrcTree`/`getSpaceSrcTree`
  already used.
- `toKebabCase`/`toPascalCase` mishandled two real inputs: a leading/trailing
  separator produced a malformed slug (`"_leading"` → `"-leading"`), and a run
  of consecutive capitals collapsed instead of splitting into its own word
  (`"XMLParser"` → `"xmlparser"` instead of `"xml-parser"`).
- `saveZanixConfig` silently swallowed every error while reading an existing
  `deno.json` — not just "the file doesn't exist yet" (the common, benign
  case), but also a malformed/corrupted existing config, which got silently
  overwritten with a fresh base config and no warning. Now only the
  missing-file case is ignored; anything else propagates.
- `zanix space build --obfuscate` crashed with an uncaught error on a
  valid-but-empty app (no comets, no declared `globalCss`, no PWA — a state
  `buildSpaceClient` itself treats as valid and skips) instead of being a
  no-op, since `buildSpaceClient` never creates the output directory in that
  case.
- `zanix space dev`'s Vite dev engine (and its file watcher) leaked if
  `activateApps`/`bootstrapServers` failed after the engine was already
  created — nothing closed it before this point, since the `unload` listener
  that normally does was only registered once both steps succeeded. Now closed
  in that failure path too.
- `baseArgumentActionCommand` (`zanix new`'s shared argument-registration
  helper) built its positional-argument declaration as
  `<optional...> <required...>` — backwards from the standard convention
  (required arguments must precede optional ones), which crashes the process
  outright the moment a command combines both. No current command does today,
  but the ordering is now correct regardless.
- `zanix new <type>` could exit `0` with **no output at all** and no project
  created when run from a directory without an existing `deno.json`/`.jsonc`
  — i.e. the exact starting point of every real `zanix new` invocation.
  Root cause: the CLI's own command registration (`setCommands()`, run
  before any argument is even parsed) eagerly imports `@zanix/server` for
  `zanix space dev`'s real use of `bootstrapServers`, and `@zanix/server`'s
  GraphQL schema module read the project config via `readConfig()` at
  _import_ time, unconditionally — throwing in a directory with no config
  yet, regardless of which subcommand actually ran. Fixed at the source
  (config is now read lazily, on first real use — see `@zanix/server`'s own
  CHANGELOG); the exact same anti-pattern existed a second time in
  `@zanix/asyncmq`, reached transitively through `@zanix/app/runtime`'s real
  `webServerManager` export (see `@zanix/asyncmq`'s own CHANGELOG). `mod.ts`
  also now wraps CLI startup/parsing in a top-level error boundary, so any
  future error of this shape is reported via `console.error` and exits
  non-zero instead of silently "succeeding."
- `baseArgumentActionCommand`'s `.action()` callback closed over the wrong
  `this` — the `new`/`generate`/`build`/`prepare`/`space` pseudo-parent
  command it was registered on, not the real leaf command (`space`,
  `handler`, ...) cliffy actually invokes the action on. Combined with a
  `@cliffy/command@1.0.0-rc.8` gap (its own error-handler lookup only checks
  one parent level up, not the full chain, while `shouldThrowErrors()`
  checks the whole chain), any error escaping a leaf action's own try/catch
  bypassed the CLI's polished error UX (help text + a clean message)
  entirely, free-falling as a raw, unformatted rejection instead.
  `Commander` now re-applies its error handler to every pseudo-parent it
  mounts (`mountGroup`), and `this.runCommand(...)` (used by every
  `zanix new <type>`'s automatic `prepare` step) now walks up to the true
  root instead of assuming a single parent hop.

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
