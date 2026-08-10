import type { ZanixSpaceSrcTree } from '@zanix/types'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import {
  assembleScaffold,
  resolveRecipe,
  type ScaffoldRecipeEntry,
  type ScaffoldRecipeRegistry,
  type ScaffoldSideEffect,
} from 'commands/new/lib/tree/recipe.ts'
import { planPage } from 'commands/generate/page/command.ts'
import { planComet } from 'commands/generate/comet/command.ts'
import { toKebabCase } from 'utils/casing.ts'
import { join } from '@std/path'

let spaceTree: ZanixSpaceSrcTree | undefined
let spaceTreeKey: string | undefined
let spaceSideEffects: ScaffoldSideEffect[] = []

/**
 * The root-level file that holds ONLY a project's `defineSpaceApp(...)` manifest, exported as the
 * default — the exact convention `@zanix/space`'s own `defineSpaceApp` JSDoc `@example` and README
 * already document (`// space.app.ts`), just not, until now, what `zanix new space`/`space-server`
 * actually scaffolded (both used to inline the manifest directly into `mod.ts` instead). Kept as a
 * plain local constant, not promoted to `@zanix/utils/constants` alongside `MAIN_MODULE` — unlike
 * `mod.ts`, this filename is a `@zanix/cli`-internal scaffold/tooling convention, never imported by
 * runtime code across a package boundary.
 */
export const SPACE_APP_MODULE = 'space.app.ts'

/**
 * The project's `defineSpaceApp(...)` manifest, alone — imported by this project's own `mod.ts`
 * (`getSpaceModTemplate`/`getServerModTemplate`'s `includeSpaceApp` branch) AND by `zanix space dev`
 * (which needs the manifest in isolation, never `mod.ts`'s own `activateApps`/`bootstrapServers`
 * call — see `zanix space dev`'s own doc for why importing `mod.ts` directly would double-boot a
 * second, dev-unaware server).
 *
 * `routesDir` is set explicitly to match where `getSpaceSrcTree` below actually writes
 * `page.tsx` — `defineSpaceApp`'s own default (`'./routes'`) would silently find zero pages
 * otherwise, since this scaffold nests everything under `src/space/` like every other project
 * type's own `src/<type>/` convention.
 */
export const getSpaceAppTemplate = (projectName: string): string => {
  const name = toKebabCase(projectName)

  return `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: '${name}',
  routesDir: './src/space/routes',
})
`
}

/**
 * Root `mod.ts` for `zanix new space` (pure frontend, no backend) — a real, runnable entrypoint,
 * never an empty placeholder. Direct composition, never `@zanix/core`: a pure-frontend project has
 * no reason to depend on `@zanix/core`'s own backend aggregation (mongo/redis/asyncmq/admin/auth)
 * — `@zanix/app`'s own `deno.json(c)` confirms neither `@zanix/app` nor `@zanix/space` depends on
 * `@zanix/core` in either direction. `activateApps` comes from `@zanix/app/runtime`, not
 * `@zanix/app`'s own root export (a real, easy-to-miss mistake — `@zanix/space`'s own README had
 * this exact import path wrong before this same investigation caught it).
 *
 * Imports the manifest from {@linkcode SPACE_APP_MODULE} rather than declaring it inline — see
 * {@linkcode getSpaceAppTemplate}'s own doc for why that split exists.
 *
 * Loads `zanix space build`'s own output (`loadCometManifest`/`loadCssManifest`/
 * `loadPwaBuildOutput`) BEFORE `activateApps()`, not after: `registerPwa` (called synchronously
 * from `setup()`, itself called synchronously during activation) reads the registered build
 * output directory exactly once, at route-registration time — it must already be known by then
 * (see `loadPwaBuildOutput`'s own doc in `@zanix/space` for the full reasoning). Comet/CSS
 * manifests don't strictly need this ordering (both are read lazily, per-request), but are loaded
 * at the same point for one consistent, easy-to-reason-about startup sequence — all three are the
 * same "build output → runtime metadata" mechanism. `'./dist/client'` matches `zanix space
 * build`'s own default `--out-dir`; edit both together if a project customizes it.
 */
export const getSpaceModTemplate = (): string => {
  return `import spaceApp from './${SPACE_APP_MODULE}'
import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers } from '@zanix/server'
import { loadCometManifest, loadCssManifest, loadPwaBuildOutput } from '@zanix/space'

// Matches \`zanix space build\`'s own default \`--out-dir\` — edit both together if you customize it.
const CLIENT_BUILD_DIR = './dist/client'
await loadCometManifest(\`\${CLIENT_BUILD_DIR}/comets-manifest.json\`)
await loadCssManifest(\`\${CLIENT_BUILD_DIR}/css-manifest.json\`)
loadPwaBuildOutput(CLIENT_BUILD_DIR)

await activateApps([spaceApp])
// Reads the Application name back off the manifest itself, rather than a second hardcoded copy of
// it — always in sync with whatever '${SPACE_APP_MODULE}' actually declares.
await bootstrapServers({ ssr: { application: spaceApp.definition.name } })
`
}

// Every leaf below calls its own generator's extracted `plan<Name>(...)`, with a placeholder
// 'Example'/'ExampleCounter' name — the same "generator is the one true source" migration §5 of
// `cli/ENGINEERING.md` already did for `server.ts`'s own handler/rto/connector/interactor/job
// examples, closed for `space.ts` too: no separately hand-maintained string constant to drift out
// of sync with what `zanix generate page`/`zanix generate comet` actually produce.
// `SPACE_RECIPE_BASE` + `assembleScaffold` (`recipe.ts`) is the same "Scaffold Recipe" `server.ts`
// uses for its own leaves — one declarative entry per leaf instead of a hand-written block.
const SPACE_RECIPE_BASE: ScaffoldRecipeEntry<ZanixSpaceSrcTree>[] = [
  {
    leaf: (tree) => tree.subfolders.routes,
    plan: (folder) => planPage('Example', folder),
  },
  {
    leaf: (tree) => tree.subfolders.comets,
    plan: (folder) => planComet('example', 'ExampleCounter', folder),
  },
]

/** `space`'s whole preset registry — see `server.ts`'s own `SERVER_RECIPES` doc, same shape and
 * same reasoning, just for `space`'s own leaves. */
export const SPACE_RECIPES: ScaffoldRecipeRegistry<ZanixSpaceSrcTree> = {
  base: SPACE_RECIPE_BASE,
}

export const getSpaceSrcTree = (
  root: string,
  preset: string = 'base',
): ZanixSpaceSrcTree => {
  const recipe = resolveRecipe(SPACE_RECIPES, preset)
  const startingPoint = join(root, 'src/space')
  const cacheKey = `${startingPoint}::${preset}`
  if (spaceTree && spaceTreeKey === cacheKey) return spaceTree

  spaceTree = ZanixTree.create<ZanixSpaceSrcTree>({ startingPoint, baseRoot: root }, {
    subfolders: {
      // Populated by `assembleScaffold` below, outside this declarative `templates` shape — see
      // `SPACE_RECIPE_BASE`'s own comment above.
      routes: { templates: { base: { files: [] } } },
      comets: { templates: { base: { files: [] } } },
    },
  })

  spaceSideEffects = assembleScaffold(spaceTree, recipe)
  spaceTreeKey = cacheKey

  return spaceTree
}

/**
 * Runs every side effect the resolved preset's own recipe entries collected — none today
 * (`base`'s `page`/`comet` have none), but wired the same way as `server.ts`'s own
 * `ensureServerScaffoldSideEffects` so a future `page`/`comet`/`layout` side effect is picked up
 * automatically the moment its recipe entry returns one, rather than needing a caller to remember
 * to wire a new call in here by hand. The `space`/`spacecraft` actions call this once, after
 * `createFilesAndFolders`, with the same `preset` the tree was built with.
 *
 * Sequential on purpose, not `Promise.all` — same reasoning as `server.ts`'s own
 * `ensureServerScaffoldSideEffects`: safe against two future side effects racing on the same file.
 */
export async function ensureSpaceScaffoldSideEffects(
  root: string,
  preset: string = 'base',
): Promise<void> {
  getSpaceSrcTree(root, preset)
  for (const sideEffect of spaceSideEffects) {
    // deno-lint-ignore no-await-in-loop
    await sideEffect(root)
  }
}
