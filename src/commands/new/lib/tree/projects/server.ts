import type { ZanixServerSrcTree } from 'typings/tree.ts'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import {
  assembleScaffold,
  resolveRecipe,
  type ScaffoldRecipeEntry,
  type ScaffoldRecipeRegistry,
  type ScaffoldSideEffect,
} from 'commands/new/lib/tree/recipe.ts'
import { planHandler } from 'commands/generate/handler/command.ts'
import { planRto } from 'commands/generate/rto/command.ts'
import { modelDefsTemplate } from 'commands/generate/repository/template.ts'
import { planSeeder } from 'commands/generate/seeder/command.ts'
import { planConnector } from 'commands/generate/connector/command.ts'
import { planInteractor } from 'commands/generate/interactor/command.ts'
import { planJob } from 'commands/generate/job/command.ts'
import { SPACE_APP_MODULE } from 'commands/new/lib/tree/projects/space.ts'
import { toKebabCase } from '@zanix/helpers'
import { join } from '@std/path'

let serverTree: ZanixServerSrcTree | undefined
let serverTreeKey: string | undefined
let serverSideEffects: ScaffoldSideEffect[] = []

/**
 * Root `mod.ts` for `zanix new server`/`zanix new spacecraft` (`space-server`) — a real, runnable
 * entrypoint (never an empty placeholder file). `Zanix.start()` (from `@zanix/core`) auto-discovers
 * every handler/interactor/connector/`.defs.ts` this scaffold generates from the project's own
 * root by default, so the minimal call with no options is enough to actually serve the example
 * `rest` handler this same scaffold writes under `src/server/handlers`. See `@zanix/core`'s own
 * README for `Zanix.start()`'s full options (per-web-server-type config, `rootDir` scoping, admin
 * APIs) and `Zanix.startWorker()` for a background-jobs-only process instead.
 *
 * Generated locally, same reasoning as `app.ts`'s own doc: neither `@zanix/server` nor
 * `@zanix/core` has a `src/templates/` directory for this to resolve against via a JSR fetch.
 *
 * @param includeSpaceApp - `true` for `space-server` (`spacecraft`) — wires the `@zanix/space`
 * app `getSpaceSrcTree` already scaffolds under `src/space/` into `Zanix.start()`'s own `apps`
 * option, the real, tested pattern for a backend project that also serves a frontend in the same
 * process (`@zanix/core`'s `Zanix.start({ apps })` calls `activateApps`/`bootstrapServers`
 * internally for each named entry — the caller never calls either directly in this case, unlike
 * the pure-`space` entrypoint in `space.ts`'s own `getSpaceModTemplate`, which calls
 * `bootstrapRemoteApp` directly instead). Imports the manifest from {@linkcode SPACE_APP_MODULE}
 * rather than declaring it inline — same split, and the same reason (`zanix space dev` needs the
 * manifest in isolation), as `space.ts`'s own `getSpaceAppTemplate`.
 *
 * **Never manually loads `zanix space build`'s own output here either — same convention
 * `space.ts`'s own `getSpaceModTemplate` established.** `Zanix.start({ apps })` routes through
 * the exact same `activateApps()` (`@zanix/app/runtime`) `bootstrapRemoteApp` calls internally —
 * `@zanix/core`'s own `start.ts` imports `activateApps`/`bootstrapAppServer` from
 * `@zanix/app/runtime` directly, never a parallel activation path of its own. `defineSpaceApp()`'s
 * own composition-scope auto-load (`@zanix/space`'s `define-space-app.ts`, gated on
 * `clientBuildDir`) therefore already runs — for all seven manifest/build-output functions, not
 * just three — the moment {@linkcode SPACE_APP_MODULE} imports below and `Zanix.start()` activates
 * it, regardless of which of the two activation entrypoints got here. A hand-written
 * `loadCometManifest`/`loadCssManifest`/`loadPwaBuildOutput` block here would be pure duplicate
 * work against those same seven, not a second real gap this template needs to cover itself.
 *
 * `server: getBootstrapSpaceAppConfig().server` — same reasoning as `space.ts`'s own
 * `getSpaceModTemplate` doc: a hand-written `server: { ssr: {} }` here would be the IDENTICAL bug
 * (naming `ssr` alone excludes `rest`, so `POST /api/log` 404s), just reached through
 * `Zanix.start({ apps })` instead of `bootstrapRemoteApp` directly. Only `.server`
 * is pulled out here (never the whole config) — `remoteInstances`/`uses`/`resources` are
 * `bootstrapRemoteApp`-specific concepts that don't apply to an app embedded via `Zanix.start`'s
 * own `apps` option.
 */
export const getServerModTemplate = (
  projectName: string,
  includeSpaceApp = false,
): string => {
  const name = toKebabCase(projectName)

  if (!includeSpaceApp) {
    return `import Zanix from '@zanix/core'

/**
 * ${name}'s entrypoint — bootstraps every server this project defines (REST/GraphQL/socket,
 * depending on which handlers exist) and auto-discovers handlers/interactors/connectors/
 * \`.defs.ts\` files from the project root. See \`@zanix/core\`'s own README for \`Zanix.start()\`'s
 * full options.
 */
await Zanix.start()
`
  }

  return `import Zanix from '@zanix/core'
import spaceApp from './${SPACE_APP_MODULE}'
import { getBootstrapSpaceAppConfig } from '@zanix/space'

/**
 * ${name}'s entrypoint — bootstraps this project's own REST/GraphQL/socket handlers (auto-
 * discovered from the project root, same as a plain \`server\` project) AND the \`@zanix/space\`
 * frontend app scaffolded under \`src/space/\`, registered as a named app so \`Zanix.start()\`
 * activates and serves both from the same process. See \`@zanix/core\`'s own README for
 * \`Zanix.start()\`'s full options.
 */
await Zanix.start({
  apps: {
    [spaceApp.definition.name]: {
      definition: spaceApp,
      server: getBootstrapSpaceAppConfig().server,
    },
  },
})
`
}

/** Filename for the worker entrypoint below — same "own local constant, not `@zanix/utils`'s
 * shared `MAIN_MODULE`" convention {@linkcode SPACE_APP_MODULE} (`space.ts`) already establishes,
 * since this is a `cli`-internal scaffold convention, not something outside code depends on. */
export const WORKER_MODULE = 'worker.ts'

/**
 * Root `worker.ts` for `zanix new server`/`zanix new spacecraft` (`space-server`) only — never
 * plain `space` (a pure frontend project has no `@zanix/core`/`@zanix/asyncmq` dependency at all,
 * see `PROJECT_TYPE_DEPENDENCIES`'s own doc). A separate entrypoint from `mod.ts`, by design:
 * `Zanix.startWorker()` bootstraps the process as a standalone AsyncMQ background-jobs worker
 * instead of an HTTP server, and always runs in its own, separate process — never the same one as
 * `mod.ts`'s own `Zanix.start()` (see `@zanix/core`'s own `startWorker()` doc). Generated locally,
 * same reasoning as `getServerModTemplate`'s own doc: neither `@zanix/server` nor `@zanix/core` has
 * a `src/templates/` directory for this to resolve against via a JSR fetch.
 */
export const getWorkerModTemplate = (projectName: string): string => {
  const name = toKebabCase(projectName)

  return `import Zanix from '@zanix/core'

/**
 * ${name}'s worker entrypoint — bootstraps this project as a standalone AsyncMQ background-jobs
 * worker instead of an HTTP server (no \`Deno.serve()\` at all). Always its own separate process
 * from \`mod.ts\` — never run both entrypoints in the same process. See \`@zanix/core\`'s own README
 * ("Worker mode") for \`Zanix.startWorker()\`'s full behavior, including its automatic
 * \`SIGINT\`/\`SIGTERM\` handling.
 */
await Zanix.startWorker()
`
}

// Every leaf below is generated locally by calling `cli`'s own `generate/` generators' extracted
// `plan<Name>(...)` functions, with a placeholder `'example'`/`'Example'` name — no JSR fetch, no
// separately hand-maintained static file to drift out of sync with what `zanix generate` actually
// produces, and no per-leaf imperative assignment either: `SERVER_RECIPES.base`
// (`assembleScaffold`'s own doc, `recipe.ts`) is the "Scaffold Recipe" `cli`'s own
// `docs/engineering.md` (§6.1) describes — one declarative entry per leaf instead of
// a hand-written block.
// `repository` deliberately still calls `modelDefsTemplate` directly, not `planRepository` — see
// that entry's own comment below for why.
const SERVER_RECIPE_BASE: ScaffoldRecipeEntry<ZanixServerSrcTree>[] = [
  {
    leaf: (tree) => tree.subfolders.connectors,
    plan: (folder) => planConnector('example', 'Example', undefined, folder),
  },
  {
    leaf: (tree) => tree.subfolders.handlers,
    plan: (folder) => planHandler('example', 'Example', 'rest', folder),
  },
  {
    leaf: (tree) => tree.subfolders.handlers.subfolders.rtos,
    plan: (folder) => {
      const { files, ensureConstants } = planRto(
        'example',
        'Example',
        [],
        folder,
      )
      return { files, sideEffects: [ensureConstants] }
    },
  },
  {
    leaf: (tree) => tree.subfolders.interactors,
    plan: (folder) => planInteractor('example', 'Example', folder),
  },
  {
    leaf: (tree) => tree.subfolders.jobs,
    plan: (folder) => planJob('example-job', '0 0 * * * *', folder),
  },
  {
    leaf: (tree) => tree.subfolders.repositories,
    // A full repository (what `planRepository` plans) is `entity.provider.ts` + `model.defs.ts`
    // together, but this scaffold wants only a standalone `model.defs.ts` example (no per-entity
    // subfolder, no provider) — a lighter shape by design, not an incomplete one: `model.defs.ts`
    // registers its model via a top-level `registerModel()` side effect and compiles standalone
    // either way. See `planRepository`'s own doc in `repository/command.ts`.
    plan: (folder) => ({
      files: [{
        PATH: join(folder, 'model.defs.ts'),
        NAME: 'model.defs.ts',
        content: () => Promise.resolve(modelDefsTemplate('Example', 'example')),
      }],
    }),
  },
  {
    leaf: (tree) => tree.subfolders.repositories.subfolders.seeders,
    plan: (folder) => {
      const { files, ensureHelper } = planSeeder(folder)
      return { files, sideEffects: [ensureHelper] }
    },
  },
]

/**
 * `server`'s whole preset registry — `base` (`SERVER_RECIPE_BASE` above) is the formalization of
 * the scaffold `zanix new server` has always produced; `zanix new server` (no `--template`) and
 * `zanix new server --template base` resolve to the exact same entry here.
 *
 * `welcome`/`population`/`population-lang` are ALSO registered, deliberately aliased to the SAME
 * `SERVER_RECIPE_BASE` array, not distinct ones — each is a real, space-only preset over on
 * `space.ts`'s own side (a landing page, or an i18n/population reference — see that file's own
 * `getSpaceRecipes`); the server side of a project has no "landing page"/"i18n" concept of its own
 * to differ on. This alias exists ONLY so `zanix new spacecraft --template welcome`/`population`/
 * `population-lang` actually resolves at all: `getZnxFolderTree` (`projects/main.ts`) threads the
 * SAME `preset` string into both `getSpaceSrcTree` AND `getServerSrcTree` for `type ===
 * 'space-server'` — with no matching entry here, `resolveRecipe(SERVER_RECIPES, preset)` would
 * throw `"Unknown template '<preset>'"` for the server half of every such scaffold, even though the
 * space half resolved fine. A plain `zanix new server --template welcome` (no `space` half at all)
 * also resolves this way, to output identical to `--template base` — a deliberate, harmless side
 * effect of the same registry both project types share, not a distinct server-only feature.
 *
 * `--theme` never reaches this registry at all — it's a `space`-only axis (see `themes.ts`'s own
 * doc), forwarded only to `getSpaceSrcTree`/`getSpaceAppTemplate`, never `getServerSrcTree`.
 */
export const SERVER_RECIPES: ScaffoldRecipeRegistry<ZanixServerSrcTree> = {
  base: SERVER_RECIPE_BASE,
  welcome: SERVER_RECIPE_BASE,
  population: SERVER_RECIPE_BASE,
  'population-lang': SERVER_RECIPE_BASE,
}

/**
 * Assembles `src/server`'s whole tree for a `server`/`space-server` project: resolves `preset`
 * against `SERVER_RECIPES` (throwing a plain `Error` for anything unknown, via `resolveRecipe`),
 * then `assembleScaffold`s every recipe entry's `plan<Name>` output onto the declarative subtree
 * below (connectors/handlers/interactors/jobs/repositories, each starting as an empty
 * placeholder). Memoized per `${startingPoint}::${preset}` — see the cache-key comment inside for
 * why `preset` is part of that key, not just `startingPoint`.
 *
 * @param root - The project's root directory.
 * @param preset - Which scaffold preset to build. Defaults to `'base'` — the only preset that
 * exists today (see `SERVER_RECIPES`'s own doc).
 */
export const getServerSrcTree = (
  root: string,
  preset: string = 'base',
): ZanixServerSrcTree => {
  const recipe = resolveRecipe(SERVER_RECIPES, preset)
  const startingPoint = join(root, 'src/server')
  // Cache key includes `preset`, not just `startingPoint` — without it, calling this with the
  // same `root` but a different `preset` (once a second preset exists) would silently return the
  // first call's stale tree instead of rebuilding for the new one.
  const cacheKey = `${startingPoint}::${preset}`
  if (serverTree && serverTreeKey === cacheKey) return serverTree

  serverTree = ZanixTree.create<ZanixServerSrcTree>({
    startingPoint,
    baseRoot: root,
  }, {
    subfolders: {
      // Populated by `assembleScaffold` below, outside this declarative `templates` shape — see
      // `SERVER_RECIPE_BASE`'s own comment above.
      connectors: { templates: { base: { files: [] } } },
      handlers: {
        templates: { base: { files: [] } },
        subfolders: {
          rtos: { templates: { base: { files: [] } } },
        },
      },
      interactors: { templates: { base: { files: [] } } },
      jobs: { templates: { base: { files: [] } } },
      repositories: {
        templates: { base: { files: [] } },
        subfolders: {
          seeders: { templates: { base: { files: [] } } },
        },
      },
    },
  })

  serverSideEffects = assembleScaffold(serverTree, recipe)
  serverTreeKey = cacheKey

  return serverTree
}

/**
 * Runs every side effect the resolved preset's own recipe entries collected (today, `base`'s own:
 * `rto`'s `ensureConstants` + `seeder`'s `ensureHelper`) — the tree `getServerSrcTree` builds only
 * holds lazy `content()` closures (no I/O until `createFilesAndFolders` actually writes them), so
 * these can't ride along inside `getServerSrcTree` itself. The `server`/`spacecraft` actions call
 * this once, after `createFilesAndFolders`, exactly like `zanix generate rto`/`zanix generate
 * seeder`'s own actions do. Generic on purpose: this function no longer needs to know which leaves
 * have side effects or call each one by name — it only runs whatever `assembleScaffold` handed
 * back, so a future recipe entry that adds `sideEffects` is picked up automatically, not silently
 * dropped the way a hand-maintained list here could be. Calls `getServerSrcTree` first,
 * with the same `preset`, specifically to populate `serverSideEffects` on a cache miss — a no-op
 * call on a cache hit (i.e. the normal case, since the action that called this already built the
 * tree with this exact `root`/`preset` pair moments earlier).
 *
 * Sequential on purpose, not `Promise.all`: a side effect like `ensureConstants` is a
 * read-current-content-then-write-back on a shared file (`src/utils/constants.ts`) — safe today
 * (`ensureConstants`/`ensureHelper` target different files), but two future recipe entries
 * appending to the *same* file concurrently would race and could drop a write. Cheap enough
 * (one-time, at `zanix new` time) that safety costs nothing here.
 */
export async function ensureServerScaffoldSideEffects(
  root: string,
  preset: string = 'base',
): Promise<void> {
  getServerSrcTree(root, preset)
  for (const sideEffect of serverSideEffects) {
    // deno-lint-ignore no-await-in-loop
    await sideEffect(root)
  }
}
