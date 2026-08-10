# `@zanix/cli` Engineering Guide

Permanent architecture/methodology reference for this repo — what a contributor needs to know to extend `@zanix/cli` correctly.
Session-by-session progress, backlog, and in-flight decisions live in the working plan document,
not here — this file only holds durable, still-true-tomorrow facts.

## 1. Purpose & Scope

`@zanix/cli` is the `zanix` command-line tool for the Zanix ecosystem: `zanix new <type>`
(bootstrap a whole project), `zanix generate <artifact> <name>` (add one artifact to an existing
project), `zanix build` (compile/obfuscate), and `zanix prepare` (git hooks, CI workflow, editor
config scaffolding). This document covers the parts of the codebase that need standing conventions
to stay consistent as more generators and commands get added — it is not a full API reference.

## 2. Features Workflow

Every generator/artifact feature in this codebase — existing and future — follows the same
discipline, established across Features 1-4 (seeder, repository, handler, rto):

1. **Evidence** — read real production usage of the artifact being generated (real repos, real
   decorator signatures, real published dependency APIs) before writing any template. Don't assume
   a shape; verify it.
2. **Decisions** — where genuine design choices exist (input mechanism, file granularity), confirm
   with the user rather than guessing.
3. **Plan** — write down what's being built and why before implementing.
4. **Implementation** — build the generator/artifact.
5. **Validation** — `deno check` the generated OUTPUT against the real, currently-published version
   of whatever dependency it imports (not an assumed API shape); 100% branch/function coverage on
   new code; full test suite green; `deno lint`/`deno fmt --check` clean.
6. **Docs** — update this file (or the relevant module's own doc comments) when the change
   introduces a new standing convention, not just new content.

## 3. Ecosystem Conventions

Ground truth for what generated code should look like, per artifact type — verified against real
production repos, not assumed:

| Concept             | Decorator                                                                             | Base class                                                                                             | Library                                       |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| REST handler        | `Controller({prefix,Interactor})` + `Get/Post/Patch/Delete/Put`                       | `ZanixController<I>`                                                                                   | server                                        |
| Interactor          | `Interactor({Connector,Provider})`                                                    | `ZanixInteractor<T>`                                                                                   | server                                        |
| Provider/repository | `Provider(type?)`                                                                     | `ZanixProvider<T>`                                                                                     | server                                        |
| Queue consumer      | `Subscriber(route\|{queue,rto,Interactor})`                                           | `ZanixSubscriber`                                                                                      | asyncmq                                       |
| Jobs                | `registerCronJob`/`registerJob` (plain functions, not decorators)                     | —                                                                                                      | asyncmq                                       |
| DB connector        | —                                                                                     | `ZanixMongoConnector`, `registerModel<Attrs>({name,definition,options,extensions:{seeders},callback})` | datamaster                                    |
| Notifications       | `NotifierProvider`/`TemplateProvider` + per-template Zod schema colocated with `.hbs` | `ZanixProvider` subclass                                                                               | notifications                                 |
| Cross-cutting auth  | `AuthTokenValidation`, `RequirePermissions`, `RateLimitGuard`, `IpAllowlistGuard`     | — (decorator-only, no scaffold target)                                                                 | auth                                          |
| Orchestration       | `Zanix.start/stop/startWorker`                                                        | —                                                                                                      | core (entrypoint target, not scaffold source) |

`@zanix/datamaster` does **not** export repository classes — those are app-code `ZanixProvider`
subclasses. `@zanix/auth` has no per-domain file shape of its own — it's "a decorator you import."

**Config-split precedent**: generic, reusable primitives (path/config resolution, casing, file
existence checks) live in `@zanix/utils`; Zanix-shape-specific logic (what a handler/RTO/repository
looks like, project-tree composition) lives in `@zanix/cli`. New work follows the same split — see
§5 for exactly where that boundary sits today.

## 4. Code-Generation Subsystem

### 4.1 Generator Module Layout

`src/commands/generate/` is organized one self-contained module per artifact type, not a flat
`actions/`+`templates/` split:

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

**Adding generator #N** means: create `<artifact>/command.ts` (+ `template.ts`), add one entry to
`registry.ts`. `main.ts` never changes.

**Registration pattern**: each `<artifact>/command.ts` exports a plain, re-callable
`register<Name>Command(cwd: Commander): void` that owns its full `.command().description()
.arguments().option()?.action()` chain. No shared generic helper tries to thread `.option()`
through a loop — cliffy's `.option()` builds a per-call, incrementally-narrowed generic type, and a
shared helper applying it generically (discovered the hard way, Feature 4/rto) breaks that
inference. A generator with no options can still use a thin registration helper (see `seeder`/
`repository`/`handler`/`connector`/`interactor`'s `command.ts` files); a generator needing options
(like `rto`'s `--field` or `job`'s `--cron`) registers its full chain directly.

Templates are embedded as inline `.ts` string-builder functions, not separate `.tpl` files read at
runtime — `cli` no longer bundles its own published package (`deno.jsonc`'s `exports` points at
`mod.ts` directly, publishing real source like every other Zanix library — see the CHANGELOG for
when that changed), but `zanix build` itself still bundles a whole project into a single output file
for its users, and a runtime file read relative to `import.meta.url` would resolve against that
bundle's own location, not the original source layout, for any project — including `cli`'s
own — that gets bundled this way. Staying inline avoids depending on `cli` never being run through
its own `build` command for some other purpose.

**Watch for**: if any `template.ts`/`renderer.ts` grows to hundreds of lines, reconsider whether it
should read from an external file instead of staying an inline string-builder — deferred until it's
an actual problem, not designed for pre-emptively.

### 4.2 Field Model Convention

Where a generator needs real per-field input (currently only `rto`), the pipeline is strictly
`DSL string → Parser → structured model → Renderer → generated code`:

- `<artifact>/parser.ts` — pure DSL-string parsing. Zero decorator/codegen knowledge. Owns its own
  literal list of supported type names (not derived from the renderer's mapping table — the two are
  kept in sync by hand, on purpose, since the parser must never import renderer-only knowledge).
- `<artifact>/renderer.ts` — consumes the structured model, owns all decorator/TS-type/codegen
  knowledge (e.g. `rto/renderer.ts`'s `FIELD_TYPE_INFO`: which `@zanix/validator` decorator, which
  TS type, whether the import is local, whether the decorator even accepts `expose` — verified
  against the real published `@zanix/validator` API via `deno check`, not assumed).

This split exists so future DSL growth (e.g. constraint modifiers) only touches the parser's syntax
layer, never forces renderer changes, and vice versa.

### 4.3 Shared vs. Cross-Cutting Utilities

Rule of thumb for where a piece of generate-adjacent logic belongs:

- **Genuinely generate-only** (encodes a generate-specific precondition or concept) →
  `generate/shared/`. Example: `assertProjectType` — "this operation requires an already-existing
  project of type X" only makes sense for incrementally adding to a project, never for `zanix new`
  (which is creating the project).
- **Horizontal, multi-consumer, or plausibly needed outside `generate/`** → stays in `src/utils/`.
  Example: `casing.ts` (`toKebabCase`/`toPascalCase` — zero generate-domain coupling),
  `projects/creation.ts` (`createFilesAndFolders`/`ensureConstant` — used by both `generate/`'s and
  `new/`'s actions).

Don't create a shared file just to match a folder-shape convention — `generate/shared/` should only
ever contain what's genuinely generate-specific; an empty-in-spirit stub adds indirection with no
payoff.

### 4.4 Public Documentation

`README.md` and `docs/{new,generate,build,prepare}.md` (at the repo root, alongside this file) are
the user-facing counterpart to this document — command reference, options tables, and verified
real-output examples for every command, kept accurate against the real `command.ts`/`template.ts`
source rather than described from memory. **Adding generator #N to `registry.ts` (§4.1) means
adding its row + its own example section to `docs/generate.md` in the same change** — an
undocumented generator is exactly the kind of drift this file exists to prevent elsewhere in the
codebase. `CHANGELOG.md` was backfilled to match the real `deno.jsonc` version at the same time;
keep the two in sync going forward (bump one, bump the other).

## 5. `src/templates/` vs. `zanix generate` — the two scaffolding mechanisms, and who owns what

Two structurally different mechanisms coexist, and it matters which one a given piece of content
should go through:

- **`zanix generate <artifact> <name>`** — parameterized, evidence-verified, tested string-builder
  functions (§4 above). Adds _one_ artifact to an _already-existing_ project.
- **`zanix new <type>`** — bootstraps a _whole new project_, assembling a folder tree
  (`src/commands/new/lib/tree/`) whose leaf nodes are either (a) locally-generated content calling
  the exact same `generate/` template functions, or (b) a static example file fetched at runtime
  from another library's own `src/templates/` folder via JSR (`getZanixTemplateContent`/
  `ZanixTree`, `src/commands/new/lib/tree/{templates,base-tree,tree,info}.ts`).

**Ownership boundary (the criterion, not a folder-name heuristic)**: for any artifact type that
already has (or could have) a `zanix generate` generator, `cli`'s own generator is the single source
of truth — never a separately hand-maintained static copy fetched from another library. This was a
real, evidence-backed migration, not a guideline written in the abstract: `handler`/`rto`/
`repository`/`seeder`'s `zanix new server` example content used to be a hand-maintained static file
in `@zanix/server`/`@zanix/datamaster`'s own `src/templates/`, fetched over JSR at scaffold time. It
was retired because that split had already produced real drift (the static examples were visibly
thinner than what the real generators produced) and a real bug (a misplaced file silently scaffolded
an empty output, undetected because nothing cross-checked the static copy against the generator's
real output). `src/commands/new/lib/tree/projects/server.ts`'s `handlers`/`handlers/rtos`/
`repositories`/`repositories/seeders` nodes now call `cli`'s own `handlerTemplate`/`rtoTemplate`/
`modelDefsTemplate`/`SEEDER_MAIN` directly, with a placeholder `'Example'` name — no JSR fetch, one
source of truth.

**Update**: `connector`, `interactor`, and `job` generators now exist too (`zanix generate
connector|interactor|job <name>`) — the same retirement was applied to them the moment they shipped.
As of this writing, **every leaf in `src/commands/new/lib/tree/projects/server.ts` generates
locally**; none of it fetches from `@zanix/server`/`@zanix/asyncmq`'s `src/templates/` anymore (both
repos' `src/templates/` are now empty/removed). `job`'s generator supports both real `@zanix/asyncmq`
shapes, verified against its actual source (`registerJob`/`registerCronJob` share the same
`processingQueue`+`handler`/`customQueue` union; `registerCronJob` just adds `isActive`+`schedule`):
`--cron <expression>` generates a schedule-driven `registerCronJob`, omitting it generates an
on-demand `registerJob`.

**What still legitimately fetches from another library's `src/templates/`**: only `@zanix/utils`'s
own generic, non-API-coupled project skeleton (README/LICENSE/CHANGELOG/generic example files) —
there's no generator to defer to (it's not a single artifact type), and it isn't `cli`-specific
domain knowledge either way. **This is not a closed list forever**: any _new_ per-artifact-type
static example a library might add later should be checked against the same criterion before being
accepted — if it's a generate-unit shape, it belongs in `cli`, not fetched.

**The entire `zanix build`/`zanix prepare` implementation cluster** (`src/commands/build/lib/`,
`src/commands/prepare/lib/`) was migrated to `cli` from `@zanix/utils` for the identical reason,
verified the identical way: every symbol in that cluster — `compileAndObfuscate`, `prepareGithub`
and its git-hook/workflow/gitignore/pre-commit-config helpers, `createVSCodeConfig` — had exactly
one real consumer ecosystem-wide (`cli` itself), confirmed by checking every public entry point and
every internal helper's callers, not just the top-level exports. `@zanix/utils` hosted the
implementation of `cli`'s own commands; it never consumed any of it as a transversal utility. Don't
add new build/prepare/scaffolding logic to `@zanix/utils` going forward — it belongs here, in
whichever of `commands/{build,prepare,new}/lib/` it's closest to.

**`prepare`'s own sub-domains (`lib/{github,editor,docker}/`) each own a local file-writer, never a
shared generic one** — `lib/docker/files/base.ts` (Docker packaging, `--docker`) is the third to
follow this, alongside `github`'s `createBaseFile`/`createWorkflow` and `editor`'s
`createEditorFileConfig`. This isn't accidental duplication: `readFileFromCurrentUrl(import.meta.url,
...)` resolves a template's path relative to the module that CALLS it, so a shared writer imported
across a domain boundary would only ever read from the ORIGINAL domain's own `base/` folder. Each
sub-domain's writer, `.base` templates, and options type stay local for this reason — don't try to
consolidate them into one shared helper without first changing how template paths resolve.
`lib/docker/files/docker-file.ts`'s own `DEFAULT_DENO_DOCKER_TAG`/`DEFAULT_PORT`/`CLIENT_BUILD_DIR`
constants are likewise deliberately local, not centralized — the same convention
`commands/new/lib/tree/projects/{server,space}.ts`'s own duplicated `CLIENT_BUILD_DIR` already
established (see that file's own doc comment).

## 6. Governance

Nothing gets committed, pushed, published, tagged, or branched in this repo (or any sibling Zanix
repo touched from a working session) without separate, explicit approval — this is a standing rule,
not a one-time authorization. Uncommitted local changes stay uncommitted until the user explicitly
asks for a commit/push/publish.

## 7. Known Follow-ups

Durable, cross-session items — not the full backlog (that lives in the working plan document):

- ~~Design `cli`'s own project-composition layer for `zanix new`~~ — **resolved**. The
  `plan<Name>`/action split is done for every generator `server.ts`/`space.ts` call (`rto`,
  `seeder`, `handler`, `connector`, `interactor`, `job`, `page`, `comet`, and `repository`'s file
  list — `repository`'s own `entity.provider.ts` isn't used by the scaffold, see `planRepository`'s
  own doc for why); `subscriber` was split too for consistency even though no scaffold calls it
  yet. Each `plan<Name>` is a pure function (no `Commander`/`assertProjectType`/logging — just "what
  files + side effects does generating this artifact need") that both `generate<Name>Action` and a
  project type's tree leaves call, so neither can drift from the other. On top of that,
  `commands/new/lib/tree/recipe.ts` now provides the "Scaffold Recipe"/"Scaffold Assembler"
  abstraction itself: `ScaffoldRecipeEntry<Tree>` (`{leaf, plan}`) + `assembleScaffold(tree,
  recipe)` turns a project type's leaves into one declarative array instead of a hand-written
  imperative block per leaf — `server.ts`'s own `SERVER_RECIPE` and `space.ts`'s `SPACE_RECIPE` are
  the two real recipes today. `assembleScaffold` also collects each entry's optional
  `sideEffects: ScaffoldSideEffect[]` (a plan's `planRto`-style `ensureConstants`/`planSeeder`-style
  `ensureHelper`, adapted to this shared array shape at the recipe's own definition site) and hands
  them back to the caller — `ensureServerScaffoldSideEffects`/`ensureSpaceScaffoldSideEffects` no
  longer hand-list which leaves have side effects; they just run whatever the recipe collected, so
  a future leaf's side effect is picked up automatically instead of needing a matching call added
  by hand. Presets (`zanix new --template <preset>`, currently inert beyond its `'base'` default)
  are the natural next consumer of this — a preset is just a second `Recipe` for the same project
  type — but designing preset _content_ is still its own, separate, evidence-first product decision
  (unrelated to this architecture piece being done).
- ~~The RTO scaffold example is illustrative, not self-contained~~ — **resolved**. `rto/command.ts`
  now exports `planRto(kebabName, pascalName, fields, rtosFolder)`, returning both the file list
  (`<name>.rto.ts` + `IsObjectID.ts` + `IsPermission.ts` when needed) and an `ensureConstants`
  closure for the `src/utils/constants.ts` side effect those files' imports depend on —
  `projects/server.ts`'s `rtos` leaf and `generateRtoAction` now call the exact same function, so
  they can't drift. `zanix new server`/`zanix new spacecraft` write `IsObjectID.ts` +
  `OBJECTID_REGEX` automatically now. The identical bug (with the identical fix) turned out to
  exist for `seeder` too, found while verifying this fix with a real `deno check` sweep over every
  generated file: `example.rto.ts`'s sibling problem was `server.ts`'s seeder leaf writing only
  `main.ts` (misnamed `seeder.ts`) without the `seeders.dev.ts`/`seeders.prod.ts` files `main.ts`
  imports, or the shared `src/utils/seeders.ts` helper — `seeder/command.ts` now exports
  `planSeeder(seedersFolder)` the same way, and `server.ts` calls it instead. Verified live: every
  `.ts` file in a freshly scaffolded `server`/`spacecraft` project now passes `deno check`
  individually.
- ~~`@zanix/space`/`@zanix/app` have no `zanix generate` generators of their own~~ — **resolved**.
  `zanix generate comet <name>`, `zanix generate page <route-path>`, and `zanix generate layout
  <route-path>` now exist (`comet`/`page`/`layout` under `src/commands/generate/`, gated to
  `['space', 'space-server']` — the first generators not gated to `['server', 'space-server']`).
  `space.ts`'s own `routes/page.tsx`/`comets/example.comet.tsx` example content now calls
  `pageTemplate('Example')`/`cometTemplate('ExampleCounter')` directly, closing the same "generator
  is the one true source" gap §5 already closed for `server`'s handler/rto/connector/interactor/job
  examples. Along the way, real evidence surfaced two deeper bugs this same investigation fixed:
  `EXAMPLE_COMET` called `defineComet(ExampleCounter)` with one argument against a real API that
  requires `defineComet(Component, sourceUrl)`, and neither `zanix new space` nor `zanix new
  spacecraft` ever generated a root entrypoint wiring `defineSpaceApp()` to anything — `mod.ts` now
  exists for `space` (direct `activateApps()`/`bootstrapServers()`, never `@zanix/core` — a pure
  frontend project has no reason to depend on its backend-aggregator tier) and correctly threads the
  space app into `Zanix.start({ apps })` for `space-server`. `@zanix/app`'s own README had
  `activateApps` imported from the wrong path (`@zanix/app` instead of `@zanix/app/runtime`) —
  caught by the same cross-repo verification pass, fixed in `@zanix/space`'s own README, not here.
- ~~`ZanixTemplates`/`createFilesAndFolders`'s `template` parameter is hardcoded to the literal type
  `'base'`~~ — **resolved, as infrastructure only** (no second preset designed yet — that's still a
  separate, evidence-first product decision, not started here). `zanix new --template <preset>` now
  actually reaches the tree-building code and is validated, closing the "inert flag" gap this bullet
  originally described. The full path is `project type → preset → Recipe → assembleScaffold()`:
  - `commands/new/lib/tree/presets.ts` — `PresetName` (currently the single literal `'base'`) and
    `KNOWN_PRESETS`. `assertKnownPreset(preset)` throws a plain `Error` for anything not in the list.
    Called first thing inside `getZnxFolderTree` (`projects/main.ts`), before any tree is built for
    _any_ project type — the one check every type shares, regardless of what runs after it.
  - `commands/new/lib/tree/recipe.ts` — `ScaffoldRecipeRegistry<Tree>` (`Record<string,
    ScaffoldRecipeEntry<Tree>[]>`) and `resolveRecipe(registry, preset)`, which throws the same kind
    of `Error` scoped to one project type's own registry. `server.ts`'s `SERVER_RECIPES`, `space.ts`'s
    `SPACE_RECIPES`, and `app.ts`'s `APP_RECIPES` are the three real registries today, each
    `{ base: <the existing recipe> }` — `SERVER_RECIPE`/`SPACE_RECIPE` from the entry above were
    renamed to `SERVER_RECIPE_BASE`/`SPACE_RECIPE_BASE` and wrapped in this registry rather than
    replaced. `getServerSrcTree`/`getSpaceSrcTree` both gained a `preset` parameter (default `'base'`)
    and now key their module-level tree cache on `` `${startingPoint}::${preset}` ``, not just
    `startingPoint` — needed so the same root requested with two different presets can't return a
    stale tree built for the first one.
  - **`assembleScaffold` now appends onto a leaf's `templates.base`, not replaces it** — the
    prerequisite that made `app` fit this mechanism at all (see the next point).
    `leaf.templates = { base: [...leaf.templates.base, ...plan.files] }` instead of
    `{ base: plan.files }`. Every leaf `server`/`space` populate this way starts as an empty
    placeholder, so this is behavior-preserving for them; it only matters once a recipe's `leaf`
    resolves to a node with real pre-existing content, which is exactly `app`'s case below.
  - `getZnxFolderTree`/`getZanixPaths` (`projects/main.ts`, `tree.ts`) both gained the same `preset`
    parameter (default `'base'`, kept in sync with `--template`'s own CLI default on purpose) and
    thread it into `getServerSrcTree`/`getSpaceSrcTree`/`getLibrarySrcTree`/`assembleAppScaffold`.
  - Every `new/actions/*.ts` file passes `options.template` as `getZanixPaths`'s third argument,
    wrapped in a `try`/`catch` that routes a thrown `Error` through `this.throw` (same convention as
    `planHandler`/`planConnector`'s own try/catch) — an unknown `--template` now fails with a clean
    CLI error _before_ `createFilesAndFolders` ever runs, for all five project types. `server.ts`/
    `space.ts`/`spacecraft.ts` also thread `template` into
    `ensureServerScaffoldSideEffects`/`ensureSpaceScaffoldSideEffects`.
  - **`app` is now fully on the same mechanism as `server`/`space`, not an exception.** Its `mod.ts`
    used to be a bare `ZNX_STRUCT.templates.base.push(...)` in `main.ts`, with no per-type validation
    of its own — the one real inconsistency this whole design left standing after the first pass.
    `app.ts` now exports `APP_RECIPE_BASE`/`APP_RECIPES` (a single entry whose `leaf` is the whole
    tree root, not a subfolder — `app` has no dedicated `src/app` subfolder) and
    `assembleAppScaffold(tree, preset)`, which `resolveRecipe`s and `assembleScaffold`s exactly like
    `server`/`space` do. This only became safe once `assembleScaffold` switched to append semantics
    above — `app`'s root node already carries `commons.ts`'s README/LICENSE/etc. before this runs, and
    the old replace semantics would have silently wiped them.
  - **`library` remains the one legitimate exception, for a different and narrower reason than `app`
    ever was.** Its only artifact, `src/modules/mod.ts`, is a static, generic placeholder fetched
    declaratively from `@zanix/utils`'s own `src/templates/` — not content a `plan<Name>` call
    generates locally (a library's whole point is user-authored content; there's no real shape for the
    CLI to know ahead of time the way it knows `server`'s example handler). That's `cli`'s other,
    pre-existing scaffolding mechanism (§5's declarative JSR-fetch, not `ScaffoldRecipeEntry`'s
    imperative `plan`) — `ScaffoldPlanFile.content` never receives the `ZanixLocalContentProps`
    (`metaUrl`/`relativePath`) a JSR fetch needs to resolve correctly, so forcing this one file through
    a recipe would mean duplicating `base-tree.ts`'s own path-resolution logic for zero real benefit —
    one static file, not decomposable leaves. `getLibrarySrcTree` still gets the same defense-in-depth
    _validation_ `resolveRecipe` gives the other three, though: it calls `assertKnownPreset` a second
    time directly, against its own `LIBRARY_KNOWN_PRESETS` list, so `library` isn't relying solely on
    the upfront global check either — only its _content generation_ stays on the declarative mechanism.
  - Extending this for a real preset #2 later touches none of `assembleScaffold`, `resolveRecipe`,
    or any generator's own `command.ts` — only `PresetName`/`KNOWN_PRESETS` (widen) and the owning
    project type's own registry (`SERVER_RECIPES`, e.g. — add one entry) change, for `server`/`space`/
    `app`. A `library`-only preset branches inside its own `assertKnownPreset` call instead. Tests:
    `src/@tests/unit/commands/new/lib/tree/presets.test.ts` (`assertKnownPreset`),
    `recipe.test.ts`'s `resolveRecipe` cases (including one proving the registry-extensibility
    contract with a fake two-preset registry, and one locking in append-not-replace semantics against
    a leaf with pre-existing content), `zanix-app-recipe.test.ts` (`APP_RECIPES`/`assembleAppScaffold`,
    including that commons.ts content survives), `src/@tests/integration/zanix-preset-resolution.test.ts`
    (implicit-vs-explicit-`base` equivalence and fail-fast-on-unknown-preset, in-process, for all five
    project types), and `src/@tests/functional/commands.new.test.ts` (the same two guarantees, but as
    real CLI subprocesses producing real files on disk, for `server`, `library`, and `app`).

Three items previously logged here are now resolved and removed from this list: retiring
`connector`/`interactor`/`jobs`'s static `src/templates/` content (done — generators now exist for
all three, see §5's update); the `connectors`/`interactors`/`jobs` empty-scaffold bug (moot as a
side effect — nothing in that path fetches over JSR anymore, so the silent-404-to-`''` failure mode
that caused it can't trigger for these artifacts); generator API drift against the four core
packages plus the missing dependency declarations in generated `deno.json` (done — see §8.1).

## 8. Generator API Drift Strategy (Known Follow-up / Engineering Decision)

The CLI generators are tested for deterministic output (i.e. the generated source matches the
expected snapshot), which by itself says nothing about whether that output still compiles against
the real, currently-published version of whatever it imports:

- `@zanix/server`
- `@zanix/validator`, `@zanix/types` (both aliases into `@zanix/utils`'s own `/validator`/`/types`
  subpaths — neither is a package of its own; see 8.1)
- `@zanix/datamaster`
- `@zanix/asyncmq`
- `@zanix/core`
- `@zanix/app`, `@zanix/space`

Mitigated with a three-layer strategy, all three now implemented:

### 8.1 Generate against known-compatible dependency versions (implemented)

`src/utils/config/dependencies.ts` is the single source of truth for every `@zanix/*` version `cli`
ever writes:

- `ZANIX_DEPENDENCY_VERSIONS: Record<string, string>` — one entry per package, the exact import
  specifier written into `imports`. Bumping a compatible version is a one-line edit here — nothing
  else in `cli` hardcodes a version of its own. `@zanix/validator` isn't a published package, so its
  entry points at `@zanix/utils`'s own `/validator` subpath (`jsr:@zanix/utils@2.*/validator`),
  matching the convention every sibling Zanix repo already uses for the same import.
- `PROJECT_TYPE_DEPENDENCIES: Record<ZanixProjects, string[]>` — which of the table above each
  project type's scaffold actually imports, verified against the real generator/template output
  (not assumed): `library` → none; `app` → `@zanix/app`; `space` → `@zanix/space`; `server` →
  `@zanix/server`/`@zanix/datamaster`/`@zanix/asyncmq`/`@zanix/validator`/`@zanix/core`;
  `space-server` → the union of `space` + `server`. `baseZnxConfig` (`utils/config/base.ts`) writes
  exactly this list into a freshly generated `deno.json` — no more, no less, no implicit versions.
  `server`/`space-server` need `@zanix/core` because their scaffold now includes a real, runnable
  root `mod.ts` (`projects/server.ts`'s `getServerModTemplate`) that calls `Zanix.start()` —
  `@zanix/core`'s own recommended way to run a Zanix project — not because any example artifact file
  imports it directly.
- `ensureZanixDependency(root, pkg)` — the `zanix generate` counterpart, for adding one artifact to
  an already-scaffolded project. Same never-clobber guarantee as `ensureConstant`: adds `pkg`'s
  import only if `deno.json` doesn't already declare it, never overrides a version the project owner
  pinned by hand. Every `generate/*/command.ts` that needs a `@zanix/*` package calls this after
  writing its files (`seeder` needs none — its templates import nothing `@zanix/*`).

`@zanix/types` (§8, not originally in the four-package list this section used to open with) was
found missing the same way the original four were: `rto`'s own `IsObjectID.ts`/`IsPermission.ts`
import `type { ValidationOptions } from '@zanix/types'`, caught by actually running `deno check` on
every file a freshly generated `server`/`spacecraft` project writes (§7's `planRto`/`planSeeder`
verification), not assumed from reading the template source. Same alias treatment as
`@zanix/validator`.

This ensures users receive a working project instead of depending on whatever `@latest` happens to
publish, and closes the concrete bug this section used to only describe in the abstract: a freshly
scaffolded `zanix new server` project used to fail `deno check` immediately (`TS2307: Import
"@zanix/server" not a dependency and not in import map`) because `deno.json`'s `imports` never
declared any of the packages the scaffold's own example files import — verified live before this
was fixed, and covered going forward by `src/@tests/unit/utils/config/dependencies.test.ts` and the
`deno.json`-import assertions in `src/@tests/functional/commands.new.test.ts`.

### 8.2 Add a scheduled "Drift Watch" CI workflow (implemented)

`.github/workflows/drift-watch.yml` — runs on a weekly schedule (Monday 06:00 UTC), on every push
to `master`, and on manual `workflow_dispatch`. Delegates the actual check to
`scripts/drift-watch.ts`, which:

1. Runs `zanix new` for every project type (`library`/`app`/`space`/`server`/`spacecraft`) into a
   temp dir, plus a curated `zanix generate` variant matrix against a fresh `server` project
   (every `handler` `--type`, `connector` `--slot` shape, `job` with/without `--cron`, a
   multi-type `rto --field` spread, `dlqprocessor`, etc.) and a fresh `space` project
   (`comet`/`page`/`layout`). `--type` is imported directly from `handler/command.ts`'s own
   `HANDLER_TYPES` (a real closed enum) rather than hand-duplicated, so that one variant axis can't
   drift from the generator it's watching; `--slot`/`--field` accept open-ended strings with no
   closed set to derive from, so those variants are curated to hit every distinct code path
   instead.
2. Rewrites each generated project's `deno.json` to the REAL latest published JSR version of every
   package in `ZANIX_DEPENDENCY_VERSIONS` (§8.1) — resolved live via `https://jsr.io/<pkg>/meta.json`
   — instead of `cli`'s own pinned range, so this actually tests "what's live on JSR right now."
   A package that can't be resolved (not published yet — `@zanix/app`/`@zanix/space` today, §7)
   is left on `cli`'s pinned range; nothing this script can fix either way.
3. Runs `deno check` against every file in each generated project and reports pass/fail per
   project/variant group.

**Informational, not blocking** — `drift-watch.yml` is never a required check and never gates
`publish.yml`; a red run means an upstream Zanix package changed in a way that broke generation
(or hasn't published yet), not that this repo regressed. Notification is the workflow run itself
(red in the Actions tab) — no auto-filed issue, no external webhook, by explicit choice: the
lowest-maintenance option, since this repo doesn't yet have an established issue-triage or
chat-notification convention to hook into.

### 8.3 Validate generated projects locally (implemented)

`--verify` — an opt-in flag on `zanix new` and every `zanix generate <artifact>` (`src/utils/verify.ts`'s
`verifyGeneratedProject`). After generation, runs `deno check` against every `.ts`/`.tsx` file in
the project and logs a warning (never changes the command's own exit code) if it doesn't compile
against whatever dependency versions are actually resolvable right now — the same check Drift
Watch (§8.2) runs on a schedule, on-demand and scoped to one project instead of every variant.

Deliberately **opt-in, not default-on**: `zanix new`/`zanix generate` are 100% local and instant
today (no network dependency), and making every invocation also do a real `deno check` against
JSR would be a genuine UX regression — slower by default, and a new failure mode in offline/CI
sandboxed environments where generation currently works fine. `--verify` gets the safety net for
whoever explicitly wants it, without changing the default experience for everyone else.

One real bug this surfaced and fixed during implementation: `deno check`'s own config-file
discovery resolves from the _calling process's_ cwd, not from the paths of the files being
checked — omitting an explicit `cwd: root` on the `Deno.Command` silently checked the generated
project against `cli`'s own `deno.jsonc` instead of the generated project's, giving a
false pass/fail entirely. Covered by a regression test
(`src/@tests/unit/utils/verify.test.ts`).

Together, these three layers provide:

- stable generated projects for users;
- early detection of upstream breaking changes;
- immediate feedback if a generated project becomes incompatible;
- no unnecessary CI failures caused by third-party package releases.
