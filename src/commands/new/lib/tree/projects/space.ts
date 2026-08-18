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
import { toKebabCase } from '@zanix/helpers'
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
 *
 * `renderer` is only ever written when `--renderer=preact` was passed — omitted entirely for the
 * default `'react'`, matching `defineSpaceApp({ renderer })`'s own doc ("choosing 'react' explicitly
 * or omitting this field are identical in every respect"): no reason for a fresh React scaffold to
 * carry a redundant, always-default field a project author never asked for.
 *
 * The renderer ENTRY POINT (`@zanix/space/react` / `@zanix/space/preact`) is written on every
 * scaffold, both renderers alike, and always as the first import. `@zanix/space` itself ships no
 * renderer implementation — importing it evaluates neither React nor Preact — so this import is
 * what installs one, and `defineSpaceApp({ renderer })` below is what DECLARES which one. The two
 * are checked against each other at startup, so a scaffold that wrote one without the other would
 * fail immediately rather than render with the wrong renderer. Both lines come from the same
 * `renderer` argument this function already receives; nothing inspects the project to guess it.
 */
export const getSpaceAppTemplate = (
  projectName: string,
  renderer?: 'react' | 'preact',
): string => {
  const name = toKebabCase(projectName)
  const rendererField = renderer === 'preact' ? "\n  renderer: 'preact'," : ''
  const rendererEntry = renderer === 'preact' ? '@zanix/space/preact' : '@zanix/space/react'

  return `import '${rendererEntry}'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: '${name}',
  routesDir: './src/space/routes',${rendererField}
})
`
}

/**
 * Root `mod.ts` for `zanix new space` (pure frontend, no backend) — a real, runnable entrypoint,
 * never an empty placeholder. Direct composition, never `@zanix/core`: a pure-frontend project has
 * no reason to depend on `@zanix/core`'s own backend aggregation (mongo/redis/asyncmq/admin/auth)
 * — `@zanix/app`'s own `deno.json(c)` confirms neither `@zanix/app` nor `@zanix/space` depends on
 * `@zanix/core` in either direction.
 *
 * Uses `bootstrapRemoteApp` (`@zanix/app/runtime`) rather than hand-rolling `activateApps` +
 * `bootstrapServers` — a `@zanix/space` app IS a Zanix App (`defineSpaceApp` wraps
 * `defineZanixApp`), so its standalone entrypoint gets the SAME real graceful shutdown
 * (`SIGINT`/`SIGTERM`, mirroring `@zanix/core`'s own `Zanix.stop()`) and optional Control Plane
 * announcement (`remoteInstances`) that a standalone `'app'` project already gets via `zanix
 * prepare --docker -p app`'s own `serve.ts` — reimplementing that by hand here would drift the two
 * out of sync the same way `dockerfile.server.base`/`dockerfile.app.base` would have if they'd
 * stayed separate. `application` is supplied automatically from the manifest's own name (never a
 * second hardcoded copy of it) — see `bootstrapAppServer`'s own doc.
 *
 * Imports the manifest from {@linkcode SPACE_APP_MODULE} rather than declaring it inline — see
 * {@linkcode getSpaceAppTemplate}'s own doc for why that split exists.
 *
 * Loads `zanix space build`'s own output (`loadCometManifest`/`loadCssManifest`/
 * `loadPwaBuildOutput`) BEFORE `bootstrapRemoteApp()`, not after: `registerPwa` (called
 * synchronously from `setup()`, itself called synchronously during activation) reads the
 * registered build output directory exactly once, at route-registration time — it must already be
 * known by then (see `loadPwaBuildOutput`'s own doc in `@zanix/space` for the full reasoning).
 * Comet/CSS manifests don't strictly need this ordering (both are read lazily, per-request), but
 * are loaded at the same point for one consistent, easy-to-reason-about startup sequence — all
 * three are the same "build output → runtime metadata" mechanism. `'./dist/client'` matches
 * `zanix space build`'s own default `--out-dir`; edit both together if a project customizes it.
 */
export const getSpaceModTemplate = (): string => {
  return `import spaceApp from './${SPACE_APP_MODULE}'
import { bootstrapRemoteApp } from '@zanix/app/runtime'
import { loadCometManifest, loadCssManifest, loadPwaBuildOutput } from '@zanix/space'

// Matches \`zanix space build\`'s own default \`--out-dir\` — edit both together if you customize it.
const CLIENT_BUILD_DIR = './dist/client'
await loadCometManifest(\`\${CLIENT_BUILD_DIR}/comets-manifest.json\`)
await loadCssManifest(\`\${CLIENT_BUILD_DIR}/css-manifest.json\`)
loadPwaBuildOutput(CLIENT_BUILD_DIR)

await bootstrapRemoteApp(spaceApp, {
  server: { ssr: {} },
  // remoteInstances: { endpoint: 'http://my-space:8000' }, // uncomment to announce to the Control Plane
})
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

/**
 * Assembles `src/space`'s whole tree for a `space`/`space-server` project: resolves `preset`
 * against `SPACE_RECIPES` (throwing a plain `Error` for anything unknown, via `resolveRecipe`),
 * then `assembleScaffold`s every recipe entry's `plan<Name>` output onto the declarative subtree
 * below (`routes`/`comets`, each starting as an empty placeholder). Memoized per
 * `${startingPoint}::${preset}` — same reasoning as `getServerSrcTree`'s own cache-key doc.
 *
 * @param root - The project's root directory.
 * @param preset - Which scaffold preset to build. Defaults to `'base'` — the only preset that
 * exists today (see `SPACE_RECIPES`'s own doc).
 */
export const getSpaceSrcTree = (
  root: string,
  preset: string = 'base',
): ZanixSpaceSrcTree => {
  const recipe = resolveRecipe(SPACE_RECIPES, preset)
  const startingPoint = join(root, 'src/space')
  // Cache key includes `preset`, not just `startingPoint` — without it, calling this with the
  // same `root` but a different `preset` would silently return the first call's stale tree
  // instead of rebuilding for the new one (same bug class `getServerSrcTree`'s own cache guards
  // against).
  const cacheKey = `${startingPoint}::${preset}`
  if (spaceTree && spaceTreeKey === cacheKey) return spaceTree

  spaceTree = ZanixTree.create<ZanixSpaceSrcTree>({
    startingPoint,
    baseRoot: root,
  }, {
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
