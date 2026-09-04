import type { ZanixLibrarySrcTree } from 'typings/tree.ts'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import { assertKnownPreset } from 'commands/new/lib/tree/presets.ts'
import { assembleScaffold, type ScaffoldRecipeEntry } from 'commands/new/lib/tree/recipe.ts'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { getFolderName, toKebabCase } from '@zanix/helpers'
import { join } from '@std/path'

/** `library`'s own known presets — degenerate today (identical to the global `KNOWN_PRESETS` in
 * `presets.ts`), kept as its own list rather than importing that one directly so a future
 * `library`-only preset doesn't have to touch the global list to exist. */
const LIBRARY_KNOWN_PRESETS = ['base']

/**
 * `src/modules/mod.ts` for `zanix new library` — a real, dependency-free starter module (never an
 * empty placeholder file, and never fetched from another package's own `src/templates/`; see
 * `PROJECT_TYPE_DEPENDENCIES`'s own `library: []` entry for why this imports no `@zanix/*` at all).
 * A library's whole point is user-authored content, so this deliberately assumes no real shape the
 * way `server`'s example handler or `app`'s manifest can — it's a starting point to replace, not a
 * worked example of a specific pattern.
 *
 * Generated locally, same "own the content, don't fetch another package's live source" reasoning as
 * `getAppModTemplate`/`getServerModTemplate`/`getSpaceModTemplate`'s own doc comments.
 */
export const getLibraryModTemplate = (libraryName: string): string => {
  const name = toKebabCase(libraryName)

  return `/**
 * ${name}'s starter module — replace \`example\` below with this library's own exports as it
 * grows. A library's whole point is user-authored content, so this has no real shape to assume
 * ahead of time; document each real export thoroughly with JSDoc as you add it.
 */
export function example(): string {
  return '${name}'
}
`
}

/**
 * `mod.ts` at the package root for `zanix new library` — the real, published entrypoint (JSR's own
 * `exports['.']` convention), re-exporting {@linkcode getLibraryModTemplate}'s own
 * `src/modules/mod.ts` starter content via an explicit `export * from './src/modules/mod.ts'`.
 * Kept as a distinct function/file from `getLibraryModTemplate` so the root entrypoint's export
 * surface stays under explicit control: the starter re-exports exactly the one module it names,
 * never the whole `src/modules/` tree by default, so a library grown with further modules under
 * `src/modules/` only widens its public surface when a real export is deliberately added here —
 * the same discipline a lean, non-bloated root barrel needs in any published Deno/JSR package,
 * modeled from day one in the project this generates.
 */
export const getLibraryRootModTemplate = (libraryName: string): string => {
  const name = toKebabCase(libraryName)

  return `/**
 * ${name}'s public entrypoint — re-exports everything meant for consumers importing
 * '${name}' itself. Add real exports to \`src/modules/mod.ts\` (or further modules under
 * \`src/modules/\`) and re-export them here as the library grows.
 */
export * from './src/modules/mod.ts'
`
}

/**
 * `library`'s tree-building mechanism — same `ScaffoldRecipeEntry`/`assembleScaffold` (`recipe.ts`)
 * `server`/`space`/`app` use for their own root-level artifacts, not a distinct mechanism: this
 * single entry's `leaf` resolves to the whole `src/modules` node built below (there's no subfolder
 * to decompose further, the same shape `APP_RECIPE_BASE`'s own single root-level entry has for
 * `app`'s `mod.ts`). Defined inside {@linkcode getLibrarySrcTree} itself, not as a module-level
 * constant the way `APP_RECIPE_BASE`/`SERVER_RECIPE_BASE` are — its `plan` needs the real project
 * name (`getFolderName(root)`), not `folder` (which `assembleScaffold` always passes as the leaf's
 * OWN `FOLDER`, `src/modules` here — the subfolder name, never the project's).
 *
 * `assertKnownPreset` is still called directly against `LIBRARY_KNOWN_PRESETS`, not `resolveRecipe`
 * — `library` has no `ScaffoldRecipeRegistry`/second preset to select between yet (unlike
 * `server`/`space`/`app`), so there is nothing for `resolveRecipe` to resolve; this keeps the same
 * defense-in-depth validation `resolveRecipe` gives the other three, just without a registry that
 * would only ever have one entry.
 */
export const getLibrarySrcTree = (
  root: string,
  preset: string = 'base',
): ZanixLibrarySrcTree => {
  assertKnownPreset(preset, LIBRARY_KNOWN_PRESETS)

  const startingPoint = join(root, 'src/modules')
  const libraryName = getFolderName(root)

  const tree = ZanixTree.create<ZanixLibrarySrcTree>({
    startingPoint,
    baseRoot: root,
  }, {
    templates: { base: { files: [] } },
  })

  const recipe: ScaffoldRecipeEntry<ZanixLibrarySrcTree>[] = [
    {
      leaf: (libraryTree) => libraryTree,
      plan: (folder) => ({
        files: [{
          PATH: join(folder, MAIN_MODULE),
          NAME: MAIN_MODULE,
          content: () => Promise.resolve(getLibraryModTemplate(libraryName)),
        }],
      }),
    },
  ]

  assembleScaffold(tree, recipe)

  return tree
}
