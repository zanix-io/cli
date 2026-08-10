import type { ZanixLibrarySrcTree } from '@zanix/types'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import { assertKnownPreset } from 'commands/new/lib/tree/presets.ts'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { join } from '@std/path'

/** `library`'s own known presets — degenerate today (identical to the global `KNOWN_PRESETS` in
 * `presets.ts`), kept as its own list rather than importing that one directly so a future
 * `library`-only preset doesn't have to touch the global list to exist. */
const LIBRARY_KNOWN_PRESETS = ['base']

/**
 * `library`'s single artifact — `src/modules/mod.ts` — is a static, generic placeholder fetched
 * declaratively from `@zanix/utils`'s own `src/templates/`, not content a `plan<Name>` call
 * generates locally (a library's whole point is user-authored content; unlike `server`'s example
 * handler, there's no real shape for the CLI to know ahead of time). That's a fundamentally
 * different, pre-existing mechanism from `server`/`space`/`app`'s `ScaffoldRecipeEntry`/
 * `assembleScaffold` (see `cli/ENGINEERING.md` §5 for the two-mechanism split) — `ScaffoldPlanFile`'s
 * `content` never receives the `ZanixLocalContentProps` (`metaUrl`/`relativePath`) a JSR fetch needs
 * to resolve correctly, so forcing this single file through a `Recipe` would mean duplicating
 * `base-tree.ts`'s own JSR path-resolution logic for zero real benefit — one static file, not
 * decomposable leaves the way `server`'s connectors/handlers/etc. are.
 *
 * `assertKnownPreset` is still called here directly, though — the same per-type defense-in-depth
 * `resolveRecipe` gives `server`/`space`, just without an actual `ScaffoldRecipeRegistry` to check
 * against (there's nothing to select between yet; a future `library` preset that changes *which*
 * JSR file gets fetched would branch here, on this same check).
 */
export const getLibrarySrcTree = (root: string, preset: string = 'base'): ZanixLibrarySrcTree => {
  assertKnownPreset(preset, LIBRARY_KNOWN_PRESETS)

  const startingPoint = join(root, 'src/modules')

  return ZanixTree.create<ZanixLibrarySrcTree>({ startingPoint, baseRoot: root }, {
    templates: { base: { files: [MAIN_MODULE], jsr: '@zanix/utils' } },
  })
}
