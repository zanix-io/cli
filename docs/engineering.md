# `@zanix/cli` Engineering Guide

Permanent architecture/methodology reference for this repo — what a contributor
needs to know to extend `@zanix/cli` correctly. This file only holds durable,
still-true-tomorrow facts — day-to-day task tracking and open backlog items live
in whatever issue tracker the team uses, not here.

## 1. Purpose & Scope

`@zanix/cli` is the `zanix` command-line tool for the Zanix ecosystem:
`zanix new <type>` (bootstrap a whole project),
`zanix generate <artifact> <name>` (add one artifact to an existing project),
`zanix build` (compile/obfuscate), `zanix space <dev|build>` (run/build a
`@zanix/space` frontend project), `zanix prepare` (git hooks, CI workflow,
editor config, and opt-in Docker packaging), `zanix report-issue` (file a
GitHub issue via the REST API — no `gh` CLI dependency, see
[`docs/report-issue.md`](./report-issue.md)), `zanix check-cycles` (detect a
real circular-import-plus-top-level-side-effect combination, see
[`docs/check-cycles.md`](./check-cycles.md)), and `zanix credentials
<mesh|password-hash>` (a matched RSA keypair set for a multi-identity service
mesh, or a single password hash, see [`docs/credentials.md`](./credentials.md)).
This document covers the parts of
the codebase that need standing conventions to stay consistent as more
generators and commands get added — it is not a full API reference.

## 2. Features Workflow

Every generator/artifact feature in this codebase — existing and future —
follows the same discipline, already established by the seeder, repository,
handler, and rto generators:

1. **Evidence** — read real production usage of the artifact being generated
   (real repos, real decorator signatures, real published dependency APIs)
   before writing any template. Don't assume a shape; verify it.
2. **Decisions** — where genuine design choices exist (input mechanism, file
   granularity), confirm with the user rather than guessing.
3. **Plan** — write down what's being built and why before implementing.
4. **Implementation** — build the generator/artifact.
5. **Validation** — `deno check` the generated OUTPUT against the real,
   currently-published version of whatever dependency it imports (not an assumed
   API shape); 100% branch/function coverage on new code; full test suite green;
   `deno lint`/`deno fmt --check` clean.
6. **Docs** — update this file (or the relevant module's own doc comments) when
   the change introduces a new standing convention, not just new content.

## 3. Ecosystem Conventions

Ground truth for what generated code should look like, per artifact type —
verified against real production repos, not assumed:

| Concept                                    | Decorator                                                                                | Base class                                                                                             | Library                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| REST handler                               | `Controller({prefix,Interactor})` + `Get/Post/Patch/Delete/Put`                          | `ZanixController<I>`                                                                                   | server                                        |
| GraphQL handler                            | `Resolver({prefix})` + `Query`/`Mutation`                                                | `ZanixResolver`                                                                                        | server†                                       |
| Socket handler                             | `Socket(route)`                                                                          | `ZanixWebSocket`                                                                                       | server                                        |
| SSR handler                                | `SsrController({prefix})` + same method decorators as REST                               | `ZanixSsrController`                                                                                   | server                                        |
| Interactor                                 | `Interactor({Connector,Provider})` (optional)                                            | `ZanixInteractor<T>`                                                                                   | server                                        |
| Provider/repository                        | `Provider(type?)`                                                                        | `ZanixProvider<T>`                                                                                     | server                                        |
| Connector shell                            | `Connector({slot?})`                                                                     | `ZanixConnector`/`ZanixDatabaseConnector`/`ZanixCacheConnector` (by `--slot`)                          | server                                        |
| Queue consumer                             | `Subscriber(route\|{queue,rto,Interactor})`                                              | `ZanixSubscriber`                                                                                      | asyncmq                                       |
| Jobs                                       | `registerCronJob`/`registerJob` (plain functions, not decorators)                        | —                                                                                                      | asyncmq‡                                      |
| DLQ processor                              | `registerDLQProcessor` (plain function)                                                  | —                                                                                                      | asyncmq§                                      |
| RTO/DTO field                              | `@zanix/validator` decorators (`IsString`, `IsEmail`, ...)                               | `BaseRTO`                                                                                              | validator (alias of `@zanix/utils/validator`) |
| Middleware (guard/pipe/interceptor)        | `defineMiddlewareDecorator(kind, fn)`                                                    | —                                                                                                      | server                                        |
| Global middleware (guard/pipe/interceptor) | `registerGlobalPipe`/`registerGlobalGuard`/`registerGlobalInterceptor` (DSL, `.defs.ts`) | —                                                                                                      | server                                        |
| Comet                                      | `'use comet'` directive + `defineComet(Component, import.meta.url)`                      | —                                                                                                      | space                                         |
| Page                                       | `@Page()`                                                                                | `SpacePageController`                                                                                  | space                                         |
| DB connector                               | —                                                                                        | `ZanixMongoConnector`, `registerModel<Attrs>({name,definition,options,extensions:{seeders},callback})` | datamaster                                    |
| Notifications                              | `NotifierProvider`/`TemplateProvider` + per-template Zod schema colocated with `.hbs`    | `ZanixProvider` subclass                                                                               | notifications                                 |
| Cross-cutting auth                         | `AuthTokenValidation`, `RequirePermissions`, `RateLimitGuard`, `IpAllowlistGuard`        | — (decorator-only, no scaffold target)                                                                 | auth                                          |
| Orchestration                              | `Zanix.start/stop/startWorker`                                                           | —                                                                                                      | core (entrypoint target, not scaffold source) |

† `ZanixResolver`/`Resolver`/`Query`/`Mutation`/`Request` are exported ONLY from
`@zanix/server/graphql`, never the root `.` — `handler/graphql.template.ts`
imports from that subpath, `import type { HandlerContext }` still from the
root. ‡ `registerCronJob`/`registerJob` are exported from `@zanix/asyncmq/jobs`,
never the bare `@zanix/asyncmq` root — `job/template.ts` imports from that
subpath. § `registerDLQProcessor` is exported from `@zanix/asyncmq/dlq` —
`dlqprocessor/template.ts` imports from that subpath.

`@zanix/datamaster` does **not** export repository classes — those are app-code
`ZanixProvider` subclasses. `@zanix/auth` has no per-domain file shape of its
own — it's "a decorator you import." `openapi`/`graphql-schema` derive rather
than scaffold (no decorator/base-class row of their own — see §4.1's own
description of both), and `component`/`layout`/`error`/`loading`/`not-found`
are plain presentational shells with no `@zanix/space` decorator or base class
to name.

**Config-split precedent**: generic, reusable primitives (path/config
resolution, casing, file existence checks) live in `@zanix/utils`;
Zanix-shape-specific logic (what a handler/RTO/repository looks like,
project-tree composition) lives in `@zanix/cli`. New work follows the same split
— see §5 for exactly where that boundary sits today.

### 3.1 Command Tree Wiring (`Commander`)

Every command group with its own leaf commands (`new`, `generate`, `build`,
`prepare`, `space`) is built the same way: a bare `new Commander()`
pseudo-parent (`cwd`) collects that family's leaves, then gets mounted onto
its own parent via **`Commander.mountGroup(name, cwd)`** — never the raw
`Command.command(name, cwd)`. As of `@cliffy/command@1.2.1` (the version this
repo pins), the library's own error-handler lookup (`getErrorHandler()`,
`command.ts:1603-1606`) already walks the whole parent chain recursively —
not just one level up — so a leaf command mounted two-plus levels below `cli`
finds `cli`'s own `.error()` handler on its own, without any help from
`mountGroup`. That wasn't always true: in `@cliffy/command@1.0.0-rc.8`, the
lookup only checked one parent level up
(`this.errorHandler ?? this._parent?.errorHandler`), unlike
`shouldThrowErrors()`, which did walk the whole chain — that gap is exactly
why `mountGroup` was built, and re-applying the handler to every pseudo-parent
it mounts is what worked around it. `mountGroup` is kept today as a
deliberate, low-cost belt-and-suspenders safeguard against a future cliffy
release reintroducing that single-level behavior, using only cliffy's own
public `.error()`/`.throwErrors()` API (no private-field access, no patching
the dependency) — not because the gap still exists. Keep using it for any new
command group anyway: skipping it costs nothing today but would silently
reopen the old failure mode the moment a future cliffy version regresses,
degrading from the polished CLI error UX (help text + a clean message) to a
raw, unformatted rejection — `mod.ts`'s own top-level boundary still catches
it, so it's never _silent_, just ugly.

Leaf commands built through `baseArgumentActionCommand` (`utils/commands.ts`)
are real `Commander` instances too — passed in explicitly as
`this.command(name, new Commander())` — not cliffy's own bare `Command` its
default `this.command(name)` would create. That's what makes
`this.runCommand(...)` (used by every `zanix new <type>`'s automatic
`--prepare` step) callable at all from inside a leaf's own action, where
`this` is that leaf; `runCommand` itself walks up to the true root rather
than assuming a single parent hop, since a leaf is two levels below `cli`
(`cli -> new -> space`), not one.

### 3.2 Lazy Action Implementation for Heavy Commands

`cli.ts`'s `setCommands()` unconditionally imports `commands/mod.ts`'s whole
barrel — every command's own module — just to REGISTER its CLI surface
(name/description/options, needed for `--help`/tab-completion to work
correctly across the whole tool), regardless of which command a user
actually runs. For a command whose real orchestration is genuinely heavy
(pulls its own large, non-universal npm dependency tree — currently `build`,
via `esbuild`/`javascript-obfuscator`, and `space`, via `@zanix/space/vite`/
`@zanix/space/dev`'s Vite/React/Preact/Tailwind/`sharp`/vanilla-extract
graph), a plain static top-level import of that implementation would let
`nodeModulesDir: "auto"` materialize the WHOLE dependency tree for every
`zanix` invocation, not just that one command: a plain static import of
every command's real orchestration pulls `deno info --json src/cli.ts` up to
roughly 1219 modules / 20 npm packages for every invocation, regardless of
which command actually runs; routed through the lazy split below, the same
graph resolves only 395 modules / 0 npm packages eagerly, and a command's own
heavy dependency tree loads only once that command is the one actually
dispatched.

The remedy is a file split, not a runtime feature-flag check — a command's
action only ever needs to actually run once Cliffy has already dispatched to
it, so no extra "is this feature enabled" gate is needed beyond correctly
structuring the split:

- **`command.ts`** (or `main.ts` for a single-leaf command like `build`) —
  stays exactly as eager as before: the full `.command().description()
  .option()...` chain, unchanged. Its `.action()` callback's body is the
  ONLY thing that changes, to:
  ```ts
  const ACTION_SPECIFIER = 'commands/<family>/<leaf>/action.ts' // non-literal — see below

  interface ActionModule {
    default: (this: Commander, options: SomeOptions) => Promise<void>
  }

  command.action(async (options) => {
    const { default: action } = await import(ACTION_SPECIFIER) as ActionModule
    return action.call(cwd, options)
  })
  ```
- **`action.ts`** — the real orchestration function, moved verbatim (own
  doc comment included) from wherever it used to live, `export default`ed.
  Its own top-level imports (however heavy) are exactly as safe as any other
  module's, since nothing outside its own lazy `import(...)` call site ever
  resolves it eagerly.

Two non-negotiable details, both load-bearing — each verifiable via a real,
isolated `deno info --json` repro:

1. **`ACTION_SPECIFIER` must be a plain `const` string, never inlined as a
   literal into the `import(...)` call.** Deno's own static dependency-graph
   analysis follows a dynamic `import()` whose argument it can resolve as a
   literal at parse time exactly like a static import — routing it through a
   variable is the only thing that keeps `cli.ts`'s own necessarily-eager
   registration graph from reaching `action.ts`'s heavy dependencies merely
   by resolving the command's CLI surface.
2. **Type the imported module with a narrow, hand-declared local interface,
   never `typeof import('commands/.../action.ts')`.** Even a whole-module
   `typeof` type alias, despite being erased from emitted JS, forces the
   same real-source resolution (and the same heavy-dependency reachability)
   as a value import — the same forces-real-resolution gotcha that breaks
   lazy-loading across package boundaries applies identically to a
   same-package lazy split. If `command.ts` and
   `action.ts` need to share an options type, declare it in the LIGHT file
   (`command.ts`) and have `action.ts` import it via `import type` from
   there — never the other direction.

`src/modules/lazy/specifiers.ts` is a SEPARATE, narrower convention from the
above — it centralizes real `npm:`/`jsr:` version-pinned specifiers for a
VALUE-level `await import(...)` inside an already-lazy file (see
`build-runner.ts`'s `ESBUILD_SPECIFIER`), matching the identical convention
`@zanix/admin`/`@zanix/core` also use for the same purpose. Add a
constant there only for a real external package specifier that needs
centralizing (e.g. to keep a version bump a one-line change, or because the
same version string is duplicated elsewhere in TYPE position and needs a
sync test) — not for a same-package local module path like
`ACTION_SPECIFIER` above, which stays a plain local constant next to its own
single call site.

## 4. Code-Generation Subsystem

### 4.1 Generator Module Layout

`src/commands/generate/` is organized one self-contained module per artifact
type, not a flat `actions/`+`templates/` split:

```
src/commands/generate/
  main.ts              -- creates the `generate` sub-Commander, iterates registry.ts, nothing else
  registry.ts           -- Array<(cwd: Commander) => void> of every register*Command function
  shared/
    project.ts           -- assertProjectType/getCurrentProjectType (generate-only, not new-shared)
  <artifact>/
    command.ts            -- registration (register<Name>Command) + the action function
    template.ts            -- (or renderer.ts for rto — see 4.2) the string-builder template(s)
```

**Adding generator #N** means: create `<artifact>/command.ts` (+ `template.ts`),
add one entry to `registry.ts`. `main.ts` never changes.

**Registration pattern**: each `<artifact>/command.ts` exports a plain,
re-callable `register<Name>Command(cwd: Commander): void` that owns its full
`.command().description()
.arguments().option()?.action()` chain. No shared
generic helper tries to thread `.option()` through a loop — cliffy's `.option()`
builds a per-call, incrementally-narrowed generic type, and a shared helper
applying it generically breaks that inference. A generator with no options
can still use a thin registration helper
(see `seeder`/ `repository`/`handler`/`connector`/`interactor`'s `command.ts`
files); a generator needing options (like `rto`'s `--field` or `job`'s `--cron`)
registers its full chain directly.

Templates are embedded as inline `.ts` string-builder functions, not separate
`.tpl` files read at runtime — `cli` publishes its own real source directly
(`deno.jsonc`'s `exports` points at `mod.ts`, not a bundled package, the same
as every other Zanix library), but
`zanix build` itself still bundles a whole project into a single output file for
its users, and a runtime file read relative to `import.meta.url` would resolve
against that bundle's own location, not the original source layout, for any
project — including `cli`'s own — that gets bundled this way. Staying inline
avoids depending on `cli` never being run through its own `build` command for
some other purpose.

**Watch for**: if any `template.ts`/`renderer.ts` grows to hundreds of lines,
reconsider whether it should read from an external file instead of staying an
inline string-builder — deferred until it's an actual problem, not designed for
pre-emptively.

**`middleware/` and `globalmiddleware/` are two separate generators, not one
generator with a 4th `--kind`**: both accept the same `--kind
<guard|pipe|interceptor>`, but they produce structurally different output —
`middleware`'s three kinds are a decorator (`defineMiddlewareDecorator`)
applied **by hand** to one handler method/class; `globalmiddleware`'s three
kinds write a DSL definition (`registerGlobalPipe`/`registerGlobalGuard`/
`registerGlobalInterceptor`, suffixed `.defs.ts`) that's **auto-discovered**
and runs against every request, never applied anywhere by hand — the same
`.defs.ts` shape `job`/`dlqprocessor` already use for the same reason. Each
owns its own `MIDDLEWARE_TYPES`/`GLOBAL_MIDDLEWARE_TYPES` map and its own
`guard.template.ts`/`pipe.template.ts`/`interceptor.template.ts` trio — see
[`docs/generate.md`](./generate.md#global-middleware) for the full
signature/file table.

**`openapi/` is the one generator whose module layout genuinely differs**:
`command.ts` (registration + action), `spec-builder.ts` (a pure
`planOpenapiSpec` — no `template.ts`, since there's no string-builder codegen
here, only a JSON document derived from real project data), and `discover.ts`
(spawns a real `deno run` subprocess rooted at the target project to call
`Zanix.compose()` and read back its route metadata — see that file's own doc
for why: native ECMAScript decorator metadata, `Symbol.metadata`, only
resolves consistently between two pieces of code sharing the same
`@zanix/utils` module instance, which `cli` and the target project never do
in-process). This is also the one generator that EXECUTES target-project code
rather than only writing files, and the one generator that regenerates its
output (`openapi.json`, at the project root) in full on every run instead of
the usual never-overwrite guarantee — both deliberate, scoped to this one
artifact's own shape (a machine-derived snapshot, not a hand-editable
scaffold), not a new default for every generator going forward.

**`graphql-schema/` shares `openapi/`'s two deliberate exceptions** (no
`template.ts`, regenerates its output in full on every run) but reaches
outside the target project a THIRD way: not a subprocess reading the target
project's own local decorator metadata, but a real, live HTTP introspection
call (`GraphQLClient.introspect()`) against each opted-in client's own
`baseUrl`. `discoverGraphqlClients` — the structural, duck-typed discovery of
every `**/*.client.ts` export shaped like a `GraphQLClient` — lives in
`commands/space/shared/discover-graphql-clients.ts`, not under
`generate/graphql-schema/` itself, specifically because `checkGraphqlSchemas`
(Layer 2 of `zanix space build`/`zanix space dev`'s own GraphQL check,
`commands/space/shared/graphql-check.ts`) needs the exact same discovery —
one shared module, never two independently-maintained copies of the same
structural check.

### 4.2 Field Model Convention

Where a generator needs real per-field input (currently only `rto`), the
pipeline is strictly
`DSL string → Parser → structured model → Renderer → generated code`:

- `<artifact>/parser.ts` — pure DSL-string parsing. Zero decorator/codegen
  knowledge. Owns its own literal list of supported type names (not derived from
  the renderer's mapping table — the two are kept in sync by hand, on purpose,
  since the parser must never import renderer-only knowledge).
- `<artifact>/renderer.ts` — consumes the structured model, owns all
  decorator/TS-type/codegen knowledge (e.g. `rto/renderer.ts`'s
  `FIELD_TYPE_INFO`: which `@zanix/validator` decorator, which TS type, whether
  the import is local, whether the decorator even accepts `expose` — verified
  against the real published `@zanix/validator` API via `deno check`, not
  assumed).

This split exists so future DSL growth (e.g. constraint modifiers) only touches
the parser's syntax layer, never forces renderer changes, and vice versa.

### 4.3 Shared vs. Cross-Cutting Utilities

Rule of thumb for where a piece of generate-adjacent logic belongs:

- **Genuinely generate-only** (encodes a generate-specific precondition or
  concept) → `generate/shared/`. Example: `assertProjectType` — "this operation
  requires an already-existing project of type X" only makes sense for
  incrementally adding to a project, never for `zanix new` (which is creating
  the project).
- **Horizontal, multi-consumer, or plausibly needed outside `generate/`** →
  stays in `src/utils/`. Example: `casing.ts` (`toKebabCase`/`toPascalCase` —
  zero generate-domain coupling), `projects/creation.ts`
  (`createFilesAndFolders`/`ensureConstant` — used by both `generate/`'s and
  `new/`'s actions).

Don't create a shared file just to match a folder-shape convention —
`generate/shared/` should only ever contain what's genuinely generate-specific;
an empty-in-spirit stub adds indirection with no payoff.

### 4.4 Public Documentation

`README.md` and `docs/{new,generate,generate-space,build,space,prepare,
report-issue,check-cycles,credentials,deploy}.md` (under `docs/`, alongside
this file) are the user-facing counterpart to this document — command
reference, options tables, and verified real-output examples for every command,
kept accurate against the real `command.ts`/`template.ts` source rather than
described from memory. **Adding generator #N to `registry.ts` (§4.1) means
adding its row + its own example section to `docs/generate.md` (backend
artifacts) or `docs/generate-space.md` (frontend artifacts) in the same
change** — an undocumented generator is exactly the kind of drift this file
exists to prevent elsewhere in the codebase. **Adding a new standing
convention (not just another same-shape artifact/generator) also means
updating this file (§3/§4) in the same change** — `docs/generate.md` alone
getting updated while this file doesn't is the matching drift on the internal
side. `CHANGELOG.md`'s version entries match the real `deno.jsonc` version;
keep the two in sync going forward (bump one, bump the other).

## 5. `src/templates/` vs. `zanix generate` — the two scaffolding mechanisms, and who owns what

Two structurally different mechanisms coexist, and it matters which one a given
piece of content should go through:

- **`zanix generate <artifact> <name>`** — parameterized, evidence-verified,
  tested string-builder functions (§4 above). Adds _one_ artifact to an
  _already-existing_ project.
- **`zanix new <type>`** — bootstraps a _whole new project_, assembling a folder
  tree (`src/commands/new/lib/tree/`) whose leaf nodes are either (a)
  locally-generated content calling the exact same `generate/` template
  functions, or (b) a static example file fetched at runtime from another
  library's own `src/templates/` folder via JSR (`getZanixTemplateContent`/
  `ZanixTree`, `src/commands/new/lib/tree/{templates,base-tree,tree,info}.ts`).

**Ownership boundary (the criterion, not a folder-name heuristic)**: for any
artifact type that already has (or could have) a `zanix generate` generator,
`cli`'s own generator is the single source of truth — never a separately
hand-maintained static copy fetched from another library. A hand-maintained
static copy fetched from another library's own `src/templates/` inevitably
drifts from what the real generator produces (a static example stays
visibly thinner than the generator's real output) and can silently ship
broken content, since nothing cross-checks it against the generator's real
output — a misplaced file scaffolding an empty output undetected is exactly
the failure mode this criterion rules out.
`src/commands/new/lib/tree/projects/server.ts`'s `handlers`/`handlers/rtos`/
`repositories`/`repositories/seeders` nodes call `cli`'s own
`handlerTemplate`/`rtoTemplate`/ `modelDefsTemplate`/`SEEDER_MAIN` directly,
with a placeholder `'Example'` name — no JSR fetch, one source of truth.
`connector`, `interactor`, and `job` generators follow the same boundary
(`zanix generate connector|interactor|job <name>`). Every leaf in
`src/commands/new/lib/tree/projects/server.ts` generates locally; none of it
fetches from `@zanix/server`/`@zanix/asyncmq`'s `src/templates/` (both repos'
`src/templates/` are empty/removed). `job`'s generator supports both
real `@zanix/asyncmq` shapes, verified against its actual source
(`registerJob`/`registerCronJob` share the same
`processingQueue`+`handler`/`customQueue` union; `registerCronJob` just adds
`isActive`+`schedule`): `--cron <expression>` generates a schedule-driven
`registerCronJob`, omitting it generates an on-demand `registerJob`.

`src/commands/new/lib/tree/projects/main.ts`'s own `src/shared/middlewares/` node (seeded for
every non-`library` project type — `server`/`space`/`space-server`/`app`) follows the same
generator-backed pattern, even though it lives in `main.ts`, not `server.ts`: `main.ts`'s
`MIDDLEWARES_RECIPE` calls `zanix generate middleware`'s own `planMiddleware('example', 'Example',
'pipe'|'interceptor', folder)` directly, merged onto the node's `templates.base` via the same
`assembleScaffold` (`recipe.ts`) append-not-replace call every other migrated leaf uses — never a
hand-rolled merge, and never a JSR fetch against `@zanix/core`'s own `src/templates/` (a directory
that has no content — `https://jsr.io/@zanix/core/1.1.0/src/templates/middlewares/pipe.defs.ts`
404s). Generated filenames follow `MIDDLEWARE_TYPES`'s own `<name>.<kind>.ts` suffix convention —
`example.pipe.ts`/`example.interceptor.ts`, the same shape `zanix generate middleware` itself
produces. `@zanix/core` is never requested anywhere under `commands/new/lib/tree` as a result (see
`info.ts`'s own `getZanixLibraryVersion` doc) — this leaf needs no content from `@zanix/core`'s own
`src/templates/` at all.

**What still legitimately fetches from another library's `src/templates/`**:
only `@zanix/utils`'s own generic, non-API-coupled project skeleton
(README/LICENSE/CHANGELOG/generic example files) — there's no generator to defer
to (it's not a single artifact type), and it isn't `cli`-specific domain
knowledge either way. **This is not a closed list forever**: any _new_
per-artifact-type static example a library might add later should be checked
against the same criterion before being accepted — if it's a generate-unit
shape, it belongs in `cli`, not fetched.

**The entire `zanix build`/`zanix prepare` implementation cluster**
(`src/commands/build/lib/`, `src/commands/prepare/lib/`) lives in `cli`
itself: every symbol in that cluster — `compileAndObfuscate`, `prepareGithub`
and its git-hook/workflow/gitignore/pre-commit-config helpers,
`createVSCodeConfig` — has exactly one real consumer ecosystem-wide (`cli`
itself), across every public entry point and every internal helper's
callers, not just the top-level exports. None of it is a transversal utility
any other package consumes. Don't add new build/prepare/scaffolding logic to
`@zanix/utils` going forward — it belongs here, in whichever of
`commands/{build,prepare,new}/lib/` it's closest to.

**`prepare`'s own sub-domains (`lib/{github,editor,docker}/`) each own a local
file-writer, never a shared generic one** — `lib/docker/files/base.ts` (Docker
packaging, `--docker`) is the third to follow this, alongside `github`'s
`createBaseFile`/`createWorkflow` and `editor`'s `createEditorFileConfig`. This
isn't accidental duplication: `readFileFromCurrentUrl(import.meta.url,
...)`
resolves a template's path relative to the module that CALLS it, so a shared
writer imported across a domain boundary would only ever read from the ORIGINAL
domain's own `base/` folder. Each sub-domain's writer, `.base` templates, and
options type stay local for this reason — don't try to consolidate them into one
shared helper without first changing how template paths resolve.
`lib/docker/files/docker-file.ts`'s own
`DEFAULT_DENO_DOCKER_TAG`/`DEFAULT_PORT`/`CLIENT_BUILD_DIR` constants are
likewise deliberately local, not centralized — the same convention
`commands/new/lib/tree/projects/space.ts`'s own `clientBuildDir:
'./.dist/client'` field (`getSpaceAppTemplate`) already establishes for the
generated project side of the same path.

## 6. Scaffold Recipes, Presets & Themes

`zanix new`'s per-project-type folder trees are assembled from a shared
Recipe/Assembler mechanism, not a hand-written imperative block per project
type. This section documents that mechanism, the preset/theme catalog it
currently drives, and how to extend it.

### 6.1 Recipe / Assembler mechanism

Every generatable leaf in a project's tree (`connectors`, `interactors`,
`jobs`, `rtos`, `routes`, `comets`, …) is produced by the same `plan<Name>`
pure planner `zanix generate <artifact>` itself calls (§4.1) — never a
separately hand-maintained copy, so a scaffolded example can't drift from
what the generator produces. `commands/new/lib/tree/recipe.ts` composes
these into one declarative array per project type instead of an imperative
block per leaf:

- `ScaffoldRecipeEntry<Tree>` — `{ leaf, plan }`: `leaf` selects a node in
  the already-built tree skeleton, `plan` is that artifact's own
  `plan<Name>`.
- `assembleScaffold(tree, recipe)` — runs every entry, appending each leaf's
  planned files onto its `templates.base` (never replacing it — see below),
  and collects every entry's optional `sideEffects` in recipe order.
  `ensureServerScaffoldSideEffects`/`ensureSpaceScaffoldSideEffects` just run
  whatever the recipe collected — a leaf that needs a side effect gets one
  added to its own recipe entry, not a matching call added elsewhere by
  hand.
- **Appends, never replaces**: `leaf.templates = { base: [...leaf.templates.base, ...plan.files] }`.
  This matters once a recipe's `leaf` resolves to a node that already
  carries real content before `assembleScaffold` runs — `app`'s
  whole-project root node, pre-populated by `commons.ts`
  (`README.md`/`CHANGELOG.md`/etc.) before its own recipe runs. A full
  replace there would silently wipe that content.
- `server.ts`'s `SERVER_RECIPE_BASE`, `space.ts`'s `SPACE_RECIPE_BASE`, and
  `app.ts`'s `APP_RECIPE_BASE` are the three current base recipes.
  `library.ts`'s own recipe is defined inline inside `getLibrarySrcTree`
  instead of as a module constant, since its `plan` needs the real project
  name (`getFolderName(root)`) rather than the fixed `folder` `assembleScaffold`
  always passes for other leaves.

### 6.2 Presets (`--template`)

`PresetName`/`KNOWN_PRESETS` (`presets.ts`) is the closed set of valid
`--template` values; `assertKnownPreset` throws a plain `Error` for anything
outside it — checked first inside `getZnxFolderTree`, before any tree is
built, for every project type. A project type's own
`ScaffoldRecipeRegistry<Tree>` (`Record<string, ScaffoldRecipeEntry<Tree>[]>`)
maps each preset it supports to its own recipe array;
`resolveRecipe(registry, preset)` throws the same kind of error, scoped to
that one registry.

Current catalog (`space`/`spacecraft` only, unless noted):

- **`base`** — every project type's default; the recipe described in §6.1.
- **`welcome`** — a real welcome landing page (`space-welcome.ts`'s
  `planWelcomePage`/`welcomePageTemplate`, built on `@zanix/space-ui`'s real
  `Link`) in place of the generic example route. The one preset whose
  content is genuinely new markup rather than a composition of an existing
  `plan<Name>` — see `space-welcome.ts`'s own doc.
- **`population`** / **`population-lang`** — a real, working i18n reference
  (`space-population.ts`), not a description of `@zanix/space`'s own
  `docs/i18n.md`/`docs/middleware.md` conventions. `population` scaffolds
  `populationGuard()` alone (one implicit locale, `messages/default/`);
  `population-lang` adds `langGuard()`/`langPreHandler` and real
  `/[lang]/...` routing with `en`/`es` catalogs. Mutually exclusive with
  each other and with `welcome`. See
  [`docs/new.md`](./new.md#--template-population----template-population-lang)
  for the full layout.

`SERVER_RECIPES` carries a matching `welcome`/`population`/`population-lang`
entry too, each a deliberate alias for `SERVER_RECIPE_BASE` (same array
reference, not a copy): `getZnxFolderTree` threads the same `preset` string
into both `getSpaceSrcTree` and `getServerSrcTree` for `space-server`, so the
server half of a `spacecraft --template <preset>` project needs a matching
registry entry to resolve at all, even though none of these presets has
server-specific content of its own. The same aliasing means a plain `zanix
new server --template welcome` (or `population`/`population-lang`) also
resolves, producing the same output as `--template base` on the server side.

### 6.3 Themes (`--theme`)

Visual identity is a separate flag from `--template`: a theme has nothing to
say about `routes`/`comets` content, and a preset has nothing to say about
CSS. `themes.ts` mirrors `presets.ts`'s shape
(`ThemeName`/`KNOWN_THEMES`/`assertKnownTheme`).

- **`default`** (`space-theme.ts`) — copies `@zanix/space-ui`'s curated
  starter theme CSS (`theme/tokens.css`, `shared/behavior.css`,
  `shared/card.css`, `theme/space-defaults.css`) into a project-root
  `theme/` folder (a sibling of `assets/`/`src/`, deliberately not nested
  under `assets/` — `assetsDir`'s route recursively and publicly serves
  everything under it as a raw static asset, so theme CSS nested there would
  be served twice: once via `globalCss`'s own bundled include, once via the
  raw scan) and wires it into `space.app.ts`'s `globalCss` (`@zanix/space`'s
  own `docs/theming.md` convention). Uses the same
  JSR-fetch-at-a-pinned-version mechanism `--icons` (`space-icons.ts`)
  already established, via the shared `resolveSpaceUiVersion` helper.
- **`astronaut`** (`space-astronaut.ts`) — a complete dark "deep space"
  palette, plus a real, interactive Comet demo that `default` doesn't have.

Both themes run entirely outside the Recipe mechanism, from
`ensureSpaceScaffoldSideEffects`'s own `--theme` branch. Both are independent
of `--icons` (each is its own real `fetch()` against `@zanix/space-ui`,
exercised together in `functional/space-theme-live.test.ts`) and of
`--renderer` for the CSS itself (no renderer-specific content) — though
`--theme astronaut`'s Comet demo and `--template welcome`'s page do depend
on `--renderer`: both resolve their `@zanix/space-ui`/hooks entrypoint
through `lib/renderer.ts`'s `getSpaceUiEntry`/`getHooksEntry` rather than
hardcoding React, so a `--renderer preact` project gets the Preact-flavored
import for either one. `--theme` never reaches the server half of a
`spacecraft` project — it has no `assets/theme/` concept there, so
`SERVER_RECIPES` needs no `--theme`-specific entry (unlike the
preset-alias entries in §6.2).

### 6.4 Extending: adding a new preset or theme

Touches none of `assembleScaffold`, `resolveRecipe`, or any generator's own
`command.ts`:

1. Widen `PresetName`/`KNOWN_PRESETS` (or `ThemeName`/`KNOWN_THEMES`).
2. Add one entry to the owning project type's own registry
   (`SERVER_RECIPES`/`SPACE_RECIPES`/`APP_RECIPES`) — an alias for the
   existing base array if the new preset has nothing project-type-specific
   to add, a real new array otherwise.
3. For `space`/`spacecraft`, also add the matching `SERVER_RECIPES` alias
   entry (§6.2) so the server half resolves.
4. For a `library`-only preset, branch inside `getLibrarySrcTree`'s own
   `assertKnownPreset` call instead — it validates against its own
   `LIBRARY_KNOWN_PRESETS` list, with no `ScaffoldRecipeRegistry` of its own
   to extend.

Tests to extend alongside a new preset/theme:
`src/@tests/unit/commands/new/lib/tree/presets.test.ts`
(`assertKnownPreset`), `recipe.test.ts`'s `resolveRecipe` cases (including
the registry-extensibility and append-not-replace contracts),
`zanix-app-recipe.test.ts` (`APP_RECIPES`/`assembleAppScaffold`),
`src/@tests/integration/zanix-preset-resolution.test.ts`
(implicit-vs-explicit-`base` equivalence and fail-fast-on-unknown-preset,
for all five project types), and `src/@tests/functional/commands.new.test.ts`
(the same two guarantees as real CLI subprocesses, for `server`, `library`,
and `app`).

### 6.5 Known gap

Every `new/actions/*.ts` file calls `createFilesAndFolders(structure,
template)`, passing `--template`'s value as the second argument — which
actually selects a key of `ZanixTemplatesRecord`, a `@zanix/types`-published
record with exactly one key, `'base'` (`ZanixTemplates = 'base'`),
regardless of which preset built the tree. `space.ts`/`spacecraft.ts` call
`createFilesAndFolders(structure, 'base')` (the literal key) instead — the
fix `welcome` required, once it made "preset" and "template record key"
diverge for the first time. `app.ts`/`server.ts`/`library.ts` still call it
with `template`: currently harmless, since none of the three has a second
preset yet (`assembleScaffold` always writes `{ base: [...] }` regardless of
preset, so the two values stay identical there), but latent — whichever of
`app`/`server`/`library` gets a real second preset next needs the same
one-line fix `space.ts`/`spacecraft.ts` already carry, before that preset
ships.

## 7. Generator API Drift Strategy

The CLI generators are tested for deterministic output (i.e. the generated
source matches the expected snapshot), which by itself says nothing about
whether that output still compiles against the real, currently-published version
of whatever it imports:

- `@zanix/server`
- `@zanix/validator` (an alias into `@zanix/utils`'s own `/validator` subpath —
  not a package of its own; see 8.1)
- `@zanix/datamaster`
- `@zanix/asyncmq`
- `@zanix/core`
- `@zanix/app`, `@zanix/space`

Mitigated with a three-layer strategy, all three now implemented:

### 7.1 Generate against known-compatible dependency versions (implemented)

`src/utils/config/dependencies.ts` is the single source of truth for every
`@zanix/*` version `cli` ever writes:

- `ZANIX_DEPENDENCY_VERSIONS: Record<string, string>` — one entry per package,
  the exact import specifier written into `imports`. Bumping a compatible
  version is a one-line edit here — nothing else in `cli` hardcodes a version of
  its own. `@zanix/validator` isn't a published package, so its entry points at
  `@zanix/utils`'s own `/validator` subpath (`jsr:@zanix/utils@^3.0.0/validator`),
  matching the convention every sibling Zanix repo already uses for the same
  import.
- `PROJECT_TYPE_DEPENDENCIES: Record<ZanixProjects, string[]>` — which of the
  table above each project type's scaffold actually imports, verified against
  the real generator/template output (not assumed): `library` → none; `app` →
  `@zanix/app`/`@zanix/utils/logger` (`getAppModTemplate`'s `mod.ts` logs through
  the real Zanix logger, never `console` — `no-znx-console`, one of the
  generated project's own scaffolded lint rules, has had a real `deno lint --fix`
  auto-fix since `@zanix/utils@3.0.0`, below `cli`'s own `^3.0.0` floor); `space` →
  `@zanix/space`; `server` →
  `@zanix/server`/`@zanix/datamaster`/`@zanix/asyncmq`/`@zanix/asyncmq/jobs`/
  `@zanix/validator`/`@zanix/core` (`@zanix/asyncmq/jobs` is its own separate key
  because `server.ts`'s tree seeds an `example-job.defs.ts` via the same
  `planJob` `zanix generate job` uses, and that file imports from that subpath,
  not the bare package root); `space-server` → the union of `space` + `server`.
  `baseZnxConfig`
  (`utils/config/base.ts`) writes exactly this list into a freshly generated
  `deno.json` — no more, no less, no implicit versions. `server`/`space-server`
  need `@zanix/core` because their scaffold now includes a real, runnable root
  `mod.ts` (`projects/server.ts`'s `getServerModTemplate`) that calls
  `Zanix.start()` — `@zanix/core`'s own recommended way to run a Zanix project —
  not because any example artifact file imports it directly.
- `ensureZanixDependency(root, pkg)` — the `zanix generate` counterpart, for
  adding one artifact to an already-scaffolded project. Same never-clobber
  guarantee as `ensureConstant`: adds `pkg`'s import only if `deno.json` doesn't
  already declare it, never overrides a version the project owner pinned by
  hand. Every `generate/*/command.ts` that needs a `@zanix/*` package calls this
  after writing its files (`seeder` needs none — its templates import nothing
  `@zanix/*`).

Every version claim in `ZANIX_DEPENDENCY_VERSIONS`/`PROJECT_TYPE_DEPENDENCIES`
is verified by actually running `deno check` on every file a freshly
generated project writes, not assumed from reading the template source —
`rto`'s own decorator catalog is the concrete example: no field type
generates a local `@zanix/types`-importing validator (see
`rto/renderer.ts`'s own doc for the full decorator-catalog reasoning), so
`@zanix/types` is absent from `PROJECT_TYPE_DEPENDENCIES.server`/
`.space-server` and `rto/command.ts` never calls `ensureZanixDependency` for
it. The version entry itself stays in
`ZANIX_DEPENDENCY_VERSIONS` regardless — same real, valid alias into
`@zanix/utils`'s own `/types` subpath, ready the moment a future field type
or generator needs it again.

This is what keeps `deno.json`'s `imports` map declaring exactly the
packages a freshly scaffolded project's own example files import — no more,
no less, and never dependent on whatever `@latest` happens to publish at
generation time. Covered by
`src/@tests/unit/utils/config/dependencies.test.ts` and the
`deno.json`-import assertions in `src/@tests/functional/commands.new.test.ts`.

### 7.2 Add a scheduled "Drift Watch" CI workflow (implemented)

`.github/workflows/drift-watch.yml` — runs on a weekly schedule (Monday 06:00
UTC), on every push to `master`, and on manual `workflow_dispatch`. Delegates
the actual check to `scripts/drift-watch.ts`, which:

1. Runs `zanix new` for every project type
   (`library`/`app`/`space`/`server`/`spacecraft`) into a temp dir, plus a
   curated `zanix generate` variant matrix against a fresh `server` project
   (every `handler` `--type`, `connector` `--slot` shape, `job` with/without
   `--cron`, every `middleware` `--kind`, every `globalmiddleware` `--kind`, a
   multi-type `rto --field` spread, `dlqprocessor`, etc.) and a fresh
   `space --icons` project
   (`comet`/`component`/`page`/`layout`/`interactor`). `--icons` is what makes
   this `space` project the only place Drift Watch ever exercises
   `@zanix/space-ui` (consumed exclusively via the `--icons` scaffold path,
   `commands/new/lib/tree/projects/space-icons.ts` — a plain `zanix new space`
   with no flags never declares that dependency at all). `--type`/`--kind` are
   imported directly from `handler/command.ts`'s own `HANDLER_TYPES`,
   `middleware/command.ts`'s own `MIDDLEWARE_TYPES`, and
   `globalmiddleware/command.ts`'s own `GLOBAL_MIDDLEWARE_TYPES` (real closed
   enums) rather than hand-duplicated, so those variant axes can't drift from
   the generators they're watching; `--slot`/`--field` accept open-ended
   strings with no closed set to derive from, so those variants are curated to
   hit every distinct code path instead.
2. Rewrites each generated project's `deno.json` to the REAL latest published
   JSR version of every package in `ZANIX_DEPENDENCY_VERSIONS` (§7.1) — resolved
   live via `https://jsr.io/<pkg>/meta.json` — instead of `cli`'s own pinned
   range, so this actually tests "what's live on JSR right now." A package
   that can't be resolved this way is left on `cli`'s pinned range; nothing
   this script can fix either way. `@zanix/server/graphql` does not exercise
   that fallback: `@zanix/server`'s real, currently-published `latest` is
   `4.1.0`, which carries the `./graphql` subpath for real (verified against
   `https://jsr.io/@zanix/server/meta.json`) — Drift Watch resolves that same
   real latest for both the bare `@zanix/server` entry and this one, and the
   `graphql` handler variant checks clean against it like any other.
3. Runs `deno check` against every file in each generated project and reports
   pass/fail per project/variant group.

**Informational, not blocking** — `drift-watch.yml` is never a required check
and never gates `publish.yml`; a red run means an upstream Zanix package changed
in a way that broke generation (or hasn't published yet), not that this repo
regressed. Notification is the workflow run itself (red in the Actions tab) — no
auto-filed issue, no external webhook, by explicit choice: the
lowest-maintenance option, since this repo doesn't yet have an established
issue-triage or chat-notification convention to hook into.

### 7.3 Validate generated projects locally (implemented)

`--verify` — an opt-in flag on `zanix new` and every `zanix generate <artifact>`
(`src/utils/verify.ts`'s `verifyGeneratedProject`). After generation, runs
`deno check` against every `.ts`/`.tsx` file in the project and logs a warning
(never changes the command's own exit code) if it doesn't compile against
whatever dependency versions are actually resolvable right now — the same check
Drift Watch (§7.2) runs on a schedule, on-demand and scoped to one project
instead of every variant.

Deliberately **opt-in, not default-on**: `zanix new`/`zanix generate` are 100%
local and instant today (no network dependency), and making every invocation
also do a real `deno check` against JSR would be a genuine UX regression —
slower by default, and a new failure mode in offline/CI sandboxed environments
where generation currently works fine. `--verify` gets the safety net for
whoever explicitly wants it, without changing the default experience for
everyone else.

`deno check`'s own config-file discovery resolves from the _calling
process's_ cwd, not from the paths of the files being checked — the
`Deno.Command` call passes an explicit `cwd: root` for exactly this reason;
without it, the check would silently run against `cli`'s own `deno.jsonc`
instead of the generated project's, giving a false pass/fail entirely.
Covered by a regression test (`src/@tests/unit/utils/verify.test.ts`).

Together, these three layers provide:

- stable generated projects for users;
- early detection of upstream breaking changes;
- immediate feedback if a generated project becomes incompatible;
- no unnecessary CI failures caused by third-party package releases.
