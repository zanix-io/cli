import type { ZanixSpaceSrcTree } from 'typings/tree.ts'

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
import { copyIconCatalog } from 'commands/new/lib/tree/projects/space-icons.ts'
import { planWelcomePage } from 'commands/new/lib/tree/projects/space-welcome.ts'
import {
  applyPopulationScaffold,
  planPopulationPage,
} from 'commands/new/lib/tree/projects/space-population.ts'
import {
  copyThemeAssets,
  getThemedGlobalCssPaths,
} from 'commands/new/lib/tree/projects/space-theme.ts'
import {
  copyAstronautAssets,
  getAstronautGlobalCssPaths,
  planAstronautComet,
} from 'commands/new/lib/tree/projects/space-astronaut.ts'
import { type PageName, writeRequestedPages } from 'commands/new/lib/tree/projects/space-pages.ts'
import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import type { RendererName } from 'commands/new/lib/renderer.ts'
import { toKebabCase } from '@zanix/helpers'
import { join } from '@std/path'
import logger from '@zanix/logger'

let spaceTree: ZanixSpaceSrcTree | undefined
let spaceTreeKey: string | undefined
let spaceSideEffects: ScaffoldSideEffect[] = []

/**
 * The root-level file that holds ONLY a project's `defineSpaceApp(...)` manifest, exported as the
 * default — the exact convention `@zanix/space`'s own `defineSpaceApp` JSDoc `@example` and README
 * already document (`// space.app.ts`), and what `zanix new space`/`space-server` actually
 * scaffolds. Kept as a plain local constant, not promoted to `@zanix/utils/constants` alongside
 * `MAIN_MODULE` — unlike `mod.ts`, this filename is a `@zanix/cli`-internal scaffold/tooling
 * convention, never imported by runtime code across a package boundary.
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
 * `clientBuildDir` is written unconditionally, matching `buildSpaceClient`'s own default output
 * directory (`'./.dist/client'`) — this is what lets `defineSpaceApp` auto-load the production
 * comet/CSS/client-entry/assets/PWA manifests and build output on its own, with no manual loader
 * calls in `mod.ts`. Always safe to write: `defineSpaceApp` itself skips the auto-load whenever a
 * dev client is active, and tolerates a directory that doesn't exist yet (pre-first-build) as a
 * no-op.
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
 *
 * `assetsDir: './assets'` is now written UNCONDITIONALLY, independent of `--icons`/`--theme`/
 * `--template` — a confirmed, real production gap, not a style preference: `@zanix/space` only
 * registers its `/assets/:path*` route (which is what serves `clientBuildDir`'s own hashed JS/CSS
 * output, alongside any user-facing static asset) when `assetsDir` is actually declared. Since
 * `clientBuildDir` above is ALSO always written, every scaffold this function produces will, the
 * moment a real `zanix space build` runs, load comet/CSS/client-entry manifests whose own build
 * output would 404 in production without this field — `define-space-app.ts`'s own runtime warning
 * in `@zanix/space` confirms this exact failure mode. `--icons`' own real files land at
 * `assets/icons/` (see `space-icons.ts`'s own doc) — genuinely served BY this same route, but no
 * longer what GATES its declaration; `ensureSpaceScaffoldSideEffects` seeds a `.gitkeep` placeholder
 * under `assets/` whenever `--icons` doesn't (see that function's own doc), so the directory always
 * exists on disk and is never invisible to `git`, even though `scanAssets` itself already tolerates
 * a directory that doesn't exist yet.
 *
 * `theme` (`--theme <name>`, independent of `renderer`/`icons`/`--template` — see `themes.ts`'s own
 * doc for why it's a separate axis) writes a `globalCss` array only when set, listing the resolved
 * theme's own `./theme/<file>` entries — `'default'` from {@linkcode getThemedGlobalCssPaths}
 * (`space-theme.ts`, `tokens.css` first, the real, current `defineSpaceApp({ globalCss })`
 * mechanism `@zanix/space`'s own `docs/theming.md` already documents, never a new one), `'astronaut'`
 * from {@linkcode getAstronautGlobalCssPaths} (`space-astronaut.ts`). This is the ONLY field
 * `theme` ever adds here — never `assetsDir`. Theme CSS deliberately lives at the project ROOT
 * (`./theme/`), never under `assets/theme/`: `assetsDir`'s route recursively scans and publicly
 * serves every file under it as a raw static asset, so a theme stylesheet placed there would be
 * duplicated — once via this same `globalCss` bundled include, once via `assetsDir`'s raw scan of
 * the identical file — two `<link>`s per stylesheet, and a layout regression from the un-bundled
 * duplicate's own cascade position. `globalCss` entries are literal source paths
 * `buildSpaceClient`/`SpaceDevEngine` resolve directly (see `SpaceAppConfig.globalCss`'s own doc),
 * never files that need `assetsDir`'s scan-and-hash pipeline — the two mechanisms must stay
 * disjoint, not just independently correct.
 *
 * `preset === 'population'`/`'population-lang'` (`space-population.ts`) additionally write
 * `messagesDir: './messages'` and an `import './src/space/middleware.ts'` — that file registers
 * `populationGuard()`/`langGuard()` (module-level side effect via `defineMiddleware`), and importing
 * it here (rather than relying on `zanix space dev`/`mod.ts` to reach it transitively some other
 * way) is what guarantees it always runs. `'population-lang'` (`withLang`) ALSO composes
 * `preHandler: getUserPreHandler()` into the SAME bootstrap config call below — `getUserPreHandler()`
 * reads back the `langPreHandler` that same `middleware.ts` registered via `definePreHandler`, and
 * re-registers it into the bootstrap config `mod.ts`'s own `getBootstrapSpaceAppConfig()` call reads
 * in production (`getSpaceModTemplate`'s own doc) — the exact composition confirmed working live in
 * `zanix-react`/`zanix-preact`, needed because `mod.ts` never imports `middleware.ts` directly.
 * Plain `'population'` has no `langPreHandler` to compose this way, so it skips that ONE field.
 *
 * **Every preset** (not just `'population-lang'`) calls `defineBootstrapSpaceAppConfig({ server: {
 * ssr: { onError: createNotFoundHandler(), attachRequestToErrors: true, ... } } })` — without this,
 * `@zanix/server`'s own `onError` is never wired, and EVERY 404 (a genuinely unmatched route, not
 * just a missing `not-found.tsx`) falls through to `@zanix/server`'s raw JSON error response instead
 * of any rendered document — this package's own built-in `DefaultNotFoundView` fallback included.
 * Confirmed as a real, universal gap in a generated project, not a hypothetical: a scaffold with NO
 * custom `not-found.tsx` at all still needs this to ever render ANY 404 page.
 * `attachRequestToErrors: true` is the one flag `createNotFoundHandler`'s own Orbit-fragment
 * handling AND `not-found.tsx`'s own `lang` prop (`NotFoundProps`, resolved via
 * `resolveRequestLang`) both need — see `createNotFoundHandler`'s own doc in `@zanix/space`.
 * Registered here (not hand-written into `mod.ts`) so `zanix space dev`'s own orchestrator, which
 * also reads `getBootstrapSpaceAppConfig()` (`dev/action.ts`'s own doc), sees the SAME registration
 * a production `mod.ts` does — same timing rule `definePreHandler`'s own composition already
 * established. This confirms the config itself reaches `bootstrapServers({ ssr })` intact under
 * `dev` too; whether `@zanix/server`'s own dev-mode dispatch actually invokes it for every request
 * shape is `dev/action.ts`'s own concern, not this file's.
 */
export const getSpaceAppTemplate = (
  projectName: string,
  renderer?: RendererName,
  theme: ThemeName | undefined = undefined,
  preset: string = 'base',
): string => {
  const name = toKebabCase(projectName)
  const rendererField = renderer === 'preact' ? "\n  renderer: 'preact'," : ''
  const rendererEntry = renderer === 'preact' ? '@zanix/space/preact' : '@zanix/space/react'
  const globalCssPaths = theme === 'default'
    ? getThemedGlobalCssPaths()
    : theme === 'astronaut'
    ? getAstronautGlobalCssPaths()
    : undefined
  const globalCssField = globalCssPaths
    ? `\n  globalCss: [\n${globalCssPaths.map((path) => `    '${path}',`).join('\n')}\n  ],`
    : ''

  const withLang = preset === 'population-lang'
  const isPopulation = preset === 'population' || withLang
  const middlewareImportLine = isPopulation ? "\nimport './src/space/middleware.ts'" : ''
  // Both variants below are hand-formatted to match this project's own `deno fmt` output exactly
  // (verified against its real `singleQuote`/`semiColons: false`/`lineWidth: 100` config) — the
  // scaffold pipeline never runs `deno fmt` itself, so a template string that doesn't already
  // comply ships as visibly unformatted in the generated project.
  const spaceImportsLine = withLang
    ? `import {
  createNotFoundHandler,
  defineBootstrapSpaceAppConfig,
  defineSpaceApp,
  getUserPreHandler,
} from '@zanix/space'`
    : `import { createNotFoundHandler, defineBootstrapSpaceAppConfig, defineSpaceApp } from '@zanix/space'`
  const bootstrapConfigLine = withLang
    ? `

defineBootstrapSpaceAppConfig({
  server: {
    ssr: {
      onError: createNotFoundHandler(),
      attachRequestToErrors: true,
      preHandler: getUserPreHandler(),
    },
  },
})`
    : `

defineBootstrapSpaceAppConfig({
  server: { ssr: { onError: createNotFoundHandler(), attachRequestToErrors: true } },
})`
  const messagesDirField = isPopulation ? `\n  messagesDir: './messages',` : ''

  return `import '${rendererEntry}'${middlewareImportLine}
${spaceImportsLine}${bootstrapConfigLine}

export default defineSpaceApp({
  name: '${name}',
  routesDir: './src/space/routes',
  clientBuildDir: './.dist/client',${rendererField}
  assetsDir: './assets',${globalCssField}${messagesDirField}
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
 * Never manually loads `zanix space build`'s own output (`loadCometManifest`/`loadCssManifest`/
 * `loadAssetsManifest`/`loadPwaBuildOutput`) — `space.app.ts`'s own `clientBuildDir` field (always
 * written, see {@linkcode getSpaceAppTemplate}'s own doc) makes `defineSpaceApp()` do all four
 * automatically, in the correct order (PWA last — see `SpaceAppConfig.clientBuildDir`'s own doc in
 * `@zanix/space` for why), before this function's own `bootstrapRemoteApp()` call ever runs.
 *
 * Passes `getBootstrapSpaceAppConfig()` (`@zanix/space`) as the WHOLE options argument, rather than
 * a hand-written `{ server: { ssr: {} } }` literal — naming `ssr` alone excludes every OTHER server
 * type from ever being served (`@zanix/server`'s own
 * `bootstrapServers`/`shouldServeType` doc), `rest` included, even though `defineSpaceApp` always
 * registers `POST /api/log` on it — every generated project 404s there in production otherwise.
 * `getBootstrapSpaceAppConfig()` always defaults `server.ssr`/`server.rest` to `{}` on its own, so
 * this one line is correct with zero project-specific wiring. A project wanting more than that
 * default (a custom `rest` config, `remoteInstances` to announce to the Control Plane, `uses`/
 * `resources` bindings) registers it via `defineBootstrapSpaceAppConfig(...)` from `space.app.ts`
 * (or anything it imports) instead of editing this file — same timing rule `definePreHandler`
 * already established, and the same reason: `zanix space dev` reads this registration too, `mod.ts`
 * never.
 */
export const getSpaceModTemplate = (): string => {
  return `import spaceApp from './${SPACE_APP_MODULE}'
import { bootstrapRemoteApp } from '@zanix/app/runtime'
import { getBootstrapSpaceAppConfig } from '@zanix/space'

// getBootstrapSpaceAppConfig() already defaults server.ssr/server.rest to {} — for a custom rest
// config, remoteInstances (Control Plane), or a non-default port, register it from space.app.ts
// instead: defineBootstrapSpaceAppConfig({ remoteInstances: { endpoint: 'http://my-space:8000' } })
await bootstrapRemoteApp(spaceApp, getBootstrapSpaceAppConfig())
`
}

// Every leaf below calls its own generator's extracted `plan<Name>(...)`, with a placeholder
// 'Example'/'ExampleCounter' name — the same "generator is the one true source" migration §5 of
// `cli`'s own `docs/engineering.md` already did for `server.ts`'s own handler/rto/connector/interactor/job
// examples, closed for `space.ts` too: no separately hand-maintained string constant to drift out
// of sync with what `zanix generate page`/`zanix generate comet` actually produce.
// `SPACE_RECIPE_BASE` + `assembleScaffold` (`recipe.ts`) is the same "Scaffold Recipe" `server.ts`
// uses for its own leaves — one declarative entry per leaf instead of a hand-written block.
//
// Deliberately has NO `comets` leaf, unlike `server.ts`'s own recipes — Comet content is `--theme`
// owned, not `--template` owned (see `getCometRecipeEntry` below and `themes.ts`'s own doc), so
// every preset's own recipe here only ever describes `routes`.
const SPACE_RECIPE_BASE: ScaffoldRecipeEntry<ZanixSpaceSrcTree>[] = [
  {
    leaf: (tree) => tree.subfolders.routes,
    plan: (folder) => planPage('Example', folder),
  },
]

/**
 * `space`'s whole preset registry, as a function of `theme`/`renderer` — the real preset #2
 * `presets.ts`'s own doc points at. `welcome`'s own `routes` leaf (`planWelcomePage`,
 * `space-welcome.ts`) is the one recipe entry that needs both threaded through (its copy adapts to
 * whether `theme === 'astronaut'`, and its `@zanix/space-ui` import resolves against `renderer` —
 * see that module's own doc), which is why this whole registry is built fresh per call rather than
 * a static top-level object the way `SERVER_RECIPES` still is (a visual theme/renderer have
 * nothing to say about the SERVER side of a project).
 *
 * `population`/`population-lang` (`planPopulationPage`, `space-population.ts`) share ONE
 * implementation, distinguished only by the `withLang` boolean literal each entry passes — see that
 * module's own doc for why the two are kept as one function rather than duplicated.
 */
export function getSpaceRecipes(
  theme?: ThemeName,
  renderer?: RendererName,
): ScaffoldRecipeRegistry<ZanixSpaceSrcTree> {
  return {
    base: SPACE_RECIPE_BASE,
    welcome: [
      {
        leaf: (tree) => tree.subfolders.routes,
        plan: (folder) => planWelcomePage(folder, theme, renderer),
      },
    ],
    population: [
      {
        leaf: (tree) => tree.subfolders.routes,
        plan: (folder) => planPopulationPage(folder, theme, renderer, false),
      },
    ],
    'population-lang': [
      {
        leaf: (tree) => tree.subfolders.routes,
        plan: (folder) => planPopulationPage(folder, theme, renderer, true),
      },
    ],
  }
}

/**
 * The ONE `comets` leaf every preset shares, applied separately from `getSpaceRecipes` above (see
 * `SPACE_RECIPE_BASE`'s own comment for why) — chosen entirely by `theme`, never by `--template`:
 * `planAstronautComet` (`space-astronaut.ts`, the interactive launch demo, matching
 * `astronaut.css`'s own `.comet-launch*` classes) when `theme === 'astronaut'`, the generic
 * placeholder counter (`generate/comet/command.ts`'s own `planComet`) otherwise. Same kebab/pascal
 * name (`'example'`/`'ExampleCounter'`) either way, so `welcome`'s own generated `page.tsx` (which
 * imports `../comets/example.comet.tsx` unconditionally) always resolves regardless of theme.
 *
 * `renderer` is forwarded to `planAstronautComet` unchanged — that demo's own `Button`/`useState`
 * imports resolve against it (see `space-astronaut.ts`'s own doc); the generic `planComet` path has
 * no `@zanix/space-ui`/hooks import of its own, so it ignores `renderer` entirely, same as it
 * already does for `theme`.
 */
function getCometRecipeEntry(
  theme?: ThemeName,
  renderer?: RendererName,
): ScaffoldRecipeEntry<ZanixSpaceSrcTree> {
  return {
    leaf: (tree) => tree.subfolders.comets,
    plan: (folder) =>
      theme === 'astronaut'
        ? planAstronautComet('example', 'ExampleCounter', folder, renderer)
        : planComet('example', 'ExampleCounter', folder),
  }
}

/**
 * Assembles `src/space`'s whole tree for a `space`/`space-server` project: resolves `preset`
 * against {@linkcode getSpaceRecipes}`(theme, renderer)` (throwing a plain `Error` for anything
 * unknown, via `resolveRecipe`) for the `routes` leaf, then applies
 * {@linkcode getCometRecipeEntry}`(theme, renderer)` separately for the `comets` leaf — two
 * independent `assembleScaffold` calls on the SAME tree (append semantics, `assembleScaffold`'s own
 * doc), since `theme` selects the `comets` leaf regardless of which `preset` governs `routes`.
 * Memoized per `${startingPoint}::${preset}::${theme}::${renderer}` — same reasoning as
 * `getServerSrcTree`'s own cache-key doc, extended with `theme`/`renderer` since both now also
 * affect tree content (`renderer` picks which `@zanix/space-ui` entrypoint `welcome`'s page and
 * `astronaut`'s comet demo import from — see `space-welcome.ts`/`space-astronaut.ts`'s own doc).
 *
 * @param root - The project's root directory.
 * @param preset - Which `--template` value to build. Defaults to `'base'`.
 * @param theme - Which `--theme` value to build, if any. Defaults to unset (no theme, no
 * `comets`-leaf override — the plain placeholder counter).
 * @param renderer - Which `--renderer` value to build for. Defaults to unset (resolves to the
 * React entrypoint everywhere `renderer` is consulted — see `lib/renderer.ts`'s own
 * `getSpaceUiEntry`/`getHooksEntry`).
 */
export const getSpaceSrcTree = (
  root: string,
  preset: string = 'base',
  theme: ThemeName | undefined = undefined,
  renderer: RendererName | undefined = undefined,
): ZanixSpaceSrcTree => {
  const recipe = resolveRecipe(getSpaceRecipes(theme, renderer), preset)
  const startingPoint = join(root, 'src/space')
  // Cache key includes `preset`/`theme`/`renderer`, not just `startingPoint` — without all three,
  // calling this with the same `root` but a different `preset`/`theme`/`renderer` would silently
  // return an earlier call's stale tree instead of rebuilding for the new one (same bug class
  // `getServerSrcTree`'s own cache guards against).
  const cacheKey = `${startingPoint}::${preset}::${theme ?? ''}::${renderer ?? ''}`
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

  const routeSideEffects = assembleScaffold(spaceTree, recipe)
  const cometSideEffects = assembleScaffold(spaceTree, [getCometRecipeEntry(theme, renderer)])
  spaceSideEffects = [...routeSideEffects, ...cometSideEffects]
  spaceTreeKey = cacheKey

  return spaceTree
}

/**
 * Guarantees `${root}/assets/` exists on disk, even when nothing else populates it (no `--icons`,
 * and `--theme`'s own CSS lives at the project ROOT now — `./theme/`, never nested under
 * `assets/theme/` — see `space-theme.ts`/`space-astronaut.ts`'s own doc for why). Writes a single
 * empty `.gitkeep` file, the same convention `zanix-space-verify`'s own real, hand-verified
 * scaffold settled on: not strictly required at RUNTIME (`scanAssets` already treats a missing
 * directory as zero assets, never an error — `assetsDir`'s own route registration in
 * `getSpaceAppTemplate` is what actually matters there, and that's unconditional regardless of
 * whether this directory has any real files), but without it an otherwise-empty directory is
 * invisible to `git` (which never tracks empty directories), leaving a scaffolded project's own
 * `assets/` folder silently absent from its first commit despite being declared in `space.app.ts`.
 * A plain local filesystem write, never a network call — unlike `copyIconCatalog`/`copyThemeAssets`/
 * `copyAstronautAssets` below, this has no real failure mode worth catching and degrading
 * gracefully around.
 */
async function ensureAssetsPlaceholder(root: string): Promise<void> {
  const dir = join(root, 'assets')
  await Deno.mkdir(dir, { recursive: true })
  await Deno.writeTextFile(join(dir, '.gitkeep'), '')
}

/**
 * Runs every side effect the resolved preset's own recipe entries collected — none today
 * (`base`'s `page`/`comet` have none), but wired the same way as `server.ts`'s own
 * `ensureServerScaffoldSideEffects` so a future `page`/`comet`/`layout` side effect is picked up
 * automatically the moment its recipe entry returns one, rather than needing a caller to remember
 * to wire a new call in here by hand. The `space`/`spacecraft` actions call this once, after
 * `createFilesAndFolders`, with the same `preset`/`theme` the tree was built with.
 *
 * Sequential on purpose, not `Promise.all` — same reasoning as `server.ts`'s own
 * `ensureServerScaffoldSideEffects`: safe against two future side effects racing on the same file.
 *
 * `icons` (`--icons`) runs {@linkcode copyIconCatalog} as a SEPARATE step after the recipe's own
 * side effects, deliberately outside `SPACE_RECIPE_BASE`/`resolveRecipe` entirely — the icon
 * catalog isn't a `preset`-shaped concern (it's not a route/comet leaf, and it must stay
 * available under every preset, current or future, not just `'base'`). Off by default, matching
 * `--icons`' own default. `renderer` is forwarded straight through to `copyIconCatalog` — it picks
 * which `@zanix/space-ui` entrypoint the generated `src/space/catalog-icon.ts` wrapper imports
 * from, same value `getSpaceAppTemplate` already uses for the SAME reason.
 *
 * `copyIconCatalog`'s call is wrapped in its own try/catch — deliberately NOT rethrown. `--icons`
 * is architecturally optional/additive (see `space-icons.ts`'s own doc: "never coupled to
 * `--template`/the visual theme"); nothing else in this function, or in the callers above it
 * (`newSpaceAction`/`newSpacecraftAction`), depends on the icon catalog existing. A failure here
 * (a real network/fetch/write error) must never take down the REST of an otherwise-successful
 * scaffold — a caller that let this propagate would leave a project with real files on disk but no
 * `saveZanixConfig` ever having run (no `zanix` section in `deno.json`), which is worse than a
 * project that's simply missing its icon catalog. `copyIconCatalog` itself still throws on failure
 * (its own contract, unchanged — see its own doc) and already cleans up any of its own partial
 * output before doing so; this function only adds a `logger.warn(..., 'noSave')` naming the real
 * underlying error (never a vaguer generic message) so the gap is visible, then lets the rest of
 * the scaffold (`saveZanixConfig`, `--verify`, `--prepare`) proceed exactly as if `--icons` had
 * never been passed.
 *
 * Returns whether the icon catalog actually landed on disk (`true`) or was skipped/degraded
 * (`false`, either `icons` was never requested, or `copyIconCatalog` itself failed) — the caller
 * (`newSpaceAction`/`newSpacecraftAction`) uses this, AFTER `saveZanixConfig` runs, to decide
 * whether to declare `@zanix/space-ui` in the generated project's own `deno.json`
 * ({@linkcode ensureSpaceUiDependency} — see its own doc for why that call can't happen from
 * inside this function, or from `copyIconCatalog` itself). Never declares the dependency on the
 * raw `icons` flag alone: a degraded `--icons` attempt writes no `catalog-icon.ts` at all, so
 * declaring the import anyway would leave `deno.json` naming a package the project doesn't
 * actually import anywhere.
 *
 * {@linkcode ensureAssetsPlaceholder} runs right after, whenever `iconsReady` is still `false` —
 * `assets/` must exist on disk (as a real, git-trackable directory) regardless of whether `--icons`
 * landed anything real in it; see that function's own doc.
 *
 * `theme === 'default'` runs {@linkcode copyThemeAssets} as its OWN separate step, right after that
 * — same "outside the recipe mechanism entirely" shape as `icons` above, same
 * graceful-degradation contract (a real network/fetch/write failure here logs a
 * `logger.warn(..., 'noSave')` and lets the rest of the scaffold proceed — `getSpaceAppTemplate`
 * has ALREADY written `space.app.ts`'s `globalCss` field by the time this runs regardless of
 * outcome, same "field reflects the requested flag, not the eventual side-effect's success"
 * contract `assetsDir`/`icons` already established for the icon catalog). Writes to `${root}/theme/`
 * — a project-root sibling of `assets/`, never nested under it (see `space-theme.ts`'s own doc for
 * why the two must stay disjoint). `theme === 'astronaut'` runs {@linkcode copyAstronautAssets} the
 * same way. Neither declares a `deno.json` dependency here — the copied files are plain `.css`; see
 * `ensureSpaceUiDependency`'s own doc (`space-icons.ts`) for where the `'astronaut'` case's OWN
 * Comet-demo dependency actually gets declared instead (after `saveZanixConfig`, in
 * `actions/space.ts`/`actions/spacecraft.ts`, alongside `'welcome'`'s).
 *
 * `pages` (`--pages <pages>`, `space-pages.ts`) writes `routes/error.tsx`/`routes/not-found.tsx`
 * as its OWN separate step, last — same "outside the recipe mechanism entirely" shape and same
 * graceful-degradation contract as `icons`/`theme` above. Independent of every other axis: an
 * empty list (the default — `--pages` never passed) is a genuine no-op, and the generated project
 * keeps relying on `@zanix/space`'s own built-in error/not-found fallback views, unchanged.
 */
export async function ensureSpaceScaffoldSideEffects(
  root: string,
  preset: string = 'base',
  icons = false,
  renderer: RendererName = 'react',
  theme: ThemeName | undefined = undefined,
  pages: readonly PageName[] = [],
): Promise<boolean> {
  getSpaceSrcTree(root, preset, theme, renderer)
  for (const sideEffect of spaceSideEffects) {
    // deno-lint-ignore no-await-in-loop
    await sideEffect(root)
  }

  let iconsReady = false
  if (icons) {
    try {
      await copyIconCatalog(root, renderer)
      iconsReady = true
    } catch (error) {
      logger.warn(
        `Icon catalog was not created ('--icons' skipped, rest of the scaffold continues): ` +
          `${(error as Error).message}`,
        'noSave',
      )
    }
  }

  // `assets/` must exist on disk regardless of whether `--icons` actually landed real content in
  // it — see `ensureAssetsPlaceholder`'s own doc for why.
  if (!iconsReady) await ensureAssetsPlaceholder(root)

  // `population`/`population-lang` (`applyPopulationScaffold`, `space-population.ts`) writes the
  // `messages/` catalog tree, `routes/layout.tsx`, and `src/space/middleware.ts` — run AFTER the
  // `icons` step above so `iconsReady` (the real post-attempt state, never the raw `--icons` flag)
  // is available for `layout.tsx`'s own conditional `<CatalogIcon>` import. Same graceful-degradation
  // contract as `--icons`/`--theme` above: a real failure here logs a warning and lets the rest of
  // the scaffold (`saveZanixConfig`, `--verify`, `--prepare`) proceed unaffected.
  if (preset === 'population' || preset === 'population-lang') {
    try {
      await applyPopulationScaffold(root, iconsReady, preset === 'population-lang')
    } catch (error) {
      logger.warn(
        `Population/i18n scaffold was not fully created ('--template ${preset}' skipped its ` +
          `messages/middleware files, rest of the scaffold continues): ${(error as Error).message}`,
        'noSave',
      )
    }
  }

  if (theme === 'default') {
    try {
      await copyThemeAssets(root)
    } catch (error) {
      logger.warn(
        `Theme assets were not created ('--theme default' skipped its CSS files, rest of the ` +
          `scaffold continues): ${(error as Error).message}`,
        'noSave',
      )
    }
  }

  if (theme === 'astronaut') {
    try {
      await copyAstronautAssets(root)
    } catch (error) {
      logger.warn(
        `Theme assets were not created ('--theme astronaut' skipped its CSS files, rest of the ` +
          `scaffold continues): ${(error as Error).message}`,
        'noSave',
      )
    }
  }

  // `--pages` (`space-pages.ts`) — same graceful-degradation contract as `--icons`/`--theme`
  // above: reuses `zanix generate error`/`zanix generate not-found`'s own template functions
  // directly, so a real filesystem failure here never blocks the rest of an otherwise-successful
  // scaffold. Omitted entirely (the default), a generated project keeps relying on
  // `@zanix/space`'s own built-in fallback views, unchanged. `theme` is forwarded alongside
  // `renderer` — `'astronaut'` picks space-flavored fallback copy for either page (see
  // `space-pages.ts`'s own doc).
  if (pages.length > 0) {
    try {
      await writeRequestedPages(root, pages, renderer, theme)
    } catch (error) {
      logger.warn(
        `'--pages' did not fully create its requested files (rest of the scaffold continues): ` +
          `${(error as Error).message}`,
        'noSave',
      )
    }
  }

  return iconsReady
}
