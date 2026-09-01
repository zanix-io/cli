import type { ZanixBaseFolder, ZanixFolderTree, ZanixProjectsFull } from '@zanix/types'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import { assertKnownPreset } from 'commands/new/lib/tree/presets.ts'
import { assertKnownTheme, type ThemeName } from 'commands/new/lib/tree/themes.ts'
import type { RendererName } from 'commands/new/lib/renderer.ts'
import { getCommonTree } from 'commands/new/lib/tree/projects/commons.ts'
import {
  getServerModTemplate,
  getServerSrcTree,
  getWorkerModTemplate,
  WORKER_MODULE,
} from 'commands/new/lib/tree/projects/server.ts'
import {
  getLibraryRootModTemplate,
  getLibrarySrcTree,
} from 'commands/new/lib/tree/projects/library.ts'
import {
  getSpaceAppTemplate,
  getSpaceModTemplate,
  getSpaceSrcTree,
  SPACE_APP_MODULE,
} from 'commands/new/lib/tree/projects/space.ts'
import { assembleAppScaffold } from 'commands/new/lib/tree/projects/app.ts'
import { assembleScaffold, type ScaffoldRecipeEntry } from 'commands/new/lib/tree/recipe.ts'
import { planMiddleware } from 'commands/generate/middleware/command.ts'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { getFolderName } from '@zanix/helpers'
import { join } from '@std/path'

/**
 * `src/shared/middlewares`'s own tiny recipe — one entry, `assembleScaffold`'s real append-not-
 * replace merge (see `recipe.ts`'s own doc), same discipline `SERVER_RECIPE_BASE`/
 * `SPACE_RECIPE_BASE`/`APP_RECIPE_BASE` already follow. Generates both example shells locally via
 * `zanix generate middleware`'s own `planMiddleware`, never a JSR fetch: `@zanix/core`'s own
 * `src/templates/` is empty, so there is no real `pipe.defs.ts`/`interceptor.defs.ts` there to
 * fetch in the first place. Not wrapped in a full
 * `ScaffoldRecipeRegistry`/`resolveRecipe` (unlike `server`/`space`/`app`'s own per-type presets):
 * `middlewares` has no preset-specific content of its own to select between, only this one shape.
 */
const MIDDLEWARES_RECIPE: ScaffoldRecipeEntry<
  ZanixBaseFolder<{ middlewares: ZanixBaseFolder }, 'noTemplates'>
>[] = [
  {
    leaf: (tree) => tree.subfolders.middlewares,
    plan: (folder) => {
      const pipe = planMiddleware('example', 'Example', 'pipe', folder)
      const interceptor = planMiddleware('example', 'Example', 'interceptor', folder)
      return { files: [...pipe.files, ...interceptor.files] }
    },
  },
]

/**
 * Zanix folders function structure for all projects.
 *
 * @param preset - `zanix new <type> --template <preset>`'s own value (default `'base'` — the same
 * default the CLI option itself carries, kept in sync deliberately, not by coincidence: `zanix new
 * <type>` and `zanix new <type> --template base` must always resolve identically). Validated here,
 * first, before any tree gets built for *any* type — the one check that runs regardless of which
 * type-specific validation follows: `resolveRecipe` for `server`/`space`/`app` (each has its own
 * `ScaffoldRecipeRegistry`), `assertKnownPreset` again, directly, for `library` (see its own doc for
 * why it has no registry of its own to resolve against).
 * @param renderer - `zanix new <type> --renderer <renderer>`'s own value — only ever consulted for
 * `space`/`space-server` (the ONLY tree types below that push a `space.app.ts` node at all), ignored
 * for every other `type`. Forwarded to {@linkcode getSpaceAppTemplate} unchanged, AND to
 * {@linkcode getSpaceSrcTree} — `welcome`'s own page and `astronaut`'s own comet demo both import
 * `@zanix/space-ui`, so the declarative tree itself needs `renderer` too, not just the
 * `space.app.ts` manifest (see `space-welcome.ts`/`space-astronaut.ts`'s own doc). Defaults to
 * `'react'`, identical in every respect to passing it explicitly.
 * @param theme - `zanix new <type> --theme <theme>`'s own value — same consultation rule as
 * `renderer` (`space`/`space-server` only). Independent of `preset`, same "only a `space.app.ts`
 * field, real file copy elsewhere" treatment (see `getSpaceAppTemplate`'s own doc for the
 * `globalCss` field it writes, and `space-theme.ts`/`space-astronaut.ts` for the actual `theme/`
 * copy, run from `ensureSpaceScaffoldSideEffects`). Defaults to `undefined` — no theme, unstyled
 * scaffold. No `icons` parameter exists here on purpose: `--icons` no longer varies anything this
 * function builds — `space.app.ts`'s `assetsDir` field is unconditional now (see
 * `getSpaceAppTemplate`'s own doc), and the actual icon-catalog file copy is a separate scaffold
 * side effect (`ensureSpaceScaffoldSideEffects`), never part of this declarative tree.
 */
export const getZnxFolderTree = <
  T extends ZanixProjectsFull,
>(
  root: string,
  type?: T,
  preset: string = 'base',
  renderer: RendererName = 'react',
  theme: ThemeName | undefined = undefined,
): ZanixFolderTree<T> => {
  assertKnownPreset(preset)
  if (theme !== undefined) assertKnownTheme(theme)

  let ZNX_STRUCT
  const commonTree = getCommonTree(root, type)

  if (!type) return commonTree as ZanixFolderTree<T>
  else ZNX_STRUCT = commonTree as unknown as ZanixFolderTree<'all'>

  // Named "family" flags, computed once from `type` — the single place that answers "which types
  // share capability X", instead of every branch below re-deriving its own
  // `type === 'a' || type === 'b'` inline. Adding a new project type, or moving an existing one
  // into/out of a capability, means editing exactly one line here, not hunting through the whole
  // function for every raw comparison that happens to need updating too.
  //
  // Deliberately WITHOUT `isAll` — `isAll` (below) is a pseudo-type that exists purely for
  // tree-shape tests asserting every possible subfolder exists at once; it must never drive a
  // ROOT-ENTRYPOINT push (`templates.base`, further down), since combining two types' own
  // mutually-exclusive `root/mod.ts` content would push a second entry at the same path. The
  // subfolder flags below fold `isAll` back in explicitly, one level down, exactly where that's
  // actually safe.
  const isLibrary = type === 'library'
  const isServerFamily = type === 'server' || type === 'space-server' // boots a real 'rest' server
  const isSpaceFamily = type === 'space' || type === 'space-server' // ships a space.app.ts manifest
  const isApp = type === 'app'
  const isAll = type === 'all'

  // Subfolder/scaffold-content flags — safe to fold `isAll` in, since none of these push a
  // `templates.base` root-entrypoint entry (each `ZanixTree`/`getXSrcTree()` call below lives at
  // its own distinct subfolder path, so composing several under `isAll` never collides).
  const hasLibraryModules = isLibrary || isAll
  // `shared/middlewares` (the `@Guard`/`@Pipe`/`@Interceptor` examples `MIDDLEWARES_RECIPE`
  // generates) is REST-flavored scaffolding — only meaningful for a project that actually boots
  // the `'rest'` server type (`isServerFamily`). A pure `space`/`app` project never does
  // (`bootstrapRemoteApp`/`Zanix.start()` is only ever given `ssr`/other non-`rest` types there),
  // so decorating anything with these examples would register a real REST controller that's
  // structurally never served — dead code by construction, not just unused boilerplate.
  const hasRestMiddlewares = isServerFamily || isAll
  const hasSpaceSrc = isSpaceFamily || isAll
  const hasServerSrc = isServerFamily || isAll
  const hasAppManifest = isApp || isAll

  if (hasLibraryModules) {
    ZNX_STRUCT.subfolders.src.subfolders.modules = getLibrarySrcTree(
      root,
      preset,
    )
  }

  if (hasRestMiddlewares) {
    ZNX_STRUCT.subfolders.src.subfolders.shared = ZanixTree.create(
      join(root, 'src/shared'),
      {
        subfolders: {
          // Populated by `assembleScaffold` below, outside this declarative `templates` shape —
          // see `MIDDLEWARES_RECIPE`'s own comment above.
          middlewares: {
            templates: {
              base: { files: [] },
            },
          },
        },
      },
    )
    assembleScaffold(ZNX_STRUCT.subfolders.src.subfolders.shared, MIDDLEWARES_RECIPE)
  }

  if (hasSpaceSrc) {
    ZNX_STRUCT.subfolders.src.subfolders.space = getSpaceSrcTree(
      root,
      preset,
      theme,
      renderer,
    )
  }

  if (hasServerSrc) {
    ZNX_STRUCT.subfolders.src.subfolders.server = getServerSrcTree(
      root,
      preset,
    )
  }

  // `app` (a `defineZanixApp()`-based package) needs no dedicated `src/app` subfolder of its own
  // — unlike `space`/`server`, its ONLY real artifact is the manifest itself, which lives at the
  // package root (`mod.ts`, the actual entry point a consumer imports), not under `src/`.
  // `assembleAppScaffold` resolves `app`'s own recipe (its own `resolveRecipe` check, same as
  // `server`/`space` get) and appends its `mod.ts` entry onto the already-built common
  // `templates.base` array — never a replace, see `assembleScaffold`'s own doc for why that matters
  // for this exact node.
  if (hasAppManifest) {
    assembleAppScaffold(
      ZNX_STRUCT as unknown as ZanixFolderTree<'app'>,
      preset,
    )
  }

  // From here on: real root-entrypoint pushes (`templates.base`) — every flag below is one of the
  // plain "family" flags from the top, deliberately never combined with `isAll` (see that flag
  // block's own doc for why).

  // `server`/`space-server` need a real, runnable root entrypoint too — same reasoning as `app`
  // above, just via `@zanix/core`'s `Zanix.start()` instead of `defineZanixApp()`.
  if (isServerFamily) {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, MAIN_MODULE),
      NAME: MAIN_MODULE,
      content: () =>
        Promise.resolve(
          getServerModTemplate(getFolderName(root), type === 'space-server'),
        ),
    })

    // A separate entrypoint/process from `mod.ts` above — see `getWorkerModTemplate`'s own doc.
    // Excludes plain `space`: it has no `@zanix/core`/`@zanix/asyncmq` dependency at all.
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, WORKER_MODULE),
      NAME: WORKER_MODULE,
      content: () => Promise.resolve(getWorkerModTemplate(getFolderName(root))),
    })
  }

  // `library`'s own package root needs a real `mod.ts` too — the actual published entrypoint
  // (JSR's `exports['.']` convention), re-exporting `getLibrarySrcTree`'s own `src/modules/mod.ts`
  // starter content.
  if (isLibrary) {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, MAIN_MODULE),
      NAME: MAIN_MODULE,
      content: () => Promise.resolve(getLibraryRootModTemplate(getFolderName(root))),
    })
  }

  // Plain `space` (pure frontend, no backend) needs its own real entrypoint too — direct
  // `bootstrapRemoteApp()` composition, never `@zanix/core` (see `getSpaceModTemplate`'s own doc
  // for why): without it, the scaffolded `page.tsx`/`example.comet.tsx` have no loader that ever
  // brings them into a running app. Exact-type check, not `isSpaceFamily` — `space-server` gets
  // its OWN root entrypoint from the `isServerFamily` branch above instead (a single `mod.ts` per
  // real type, never two competing pushes at the same path).
  if (type === 'space') {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, MAIN_MODULE),
      NAME: MAIN_MODULE,
      content: () => Promise.resolve(getSpaceModTemplate()),
    })
  }

  // `space`/`space-server` both need `space.app.ts` — the manifest alone, split out of `mod.ts` (see
  // `getSpaceAppTemplate`'s own doc). `zanix space dev` imports this file directly; `mod.ts` (pushed
  // above, either branch) imports its default export rather than declaring the manifest inline.
  if (isSpaceFamily) {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, SPACE_APP_MODULE),
      NAME: SPACE_APP_MODULE,
      content: () =>
        Promise.resolve(
          getSpaceAppTemplate(
            getFolderName(root),
            renderer,
            theme,
            preset,
          ),
        ),
    })
  }

  return ZNX_STRUCT as ZanixFolderTree<T>
}
