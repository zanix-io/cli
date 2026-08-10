/**
 * `zanix new --template <preset>` — the whole-project-type preset axis. Only `'base'` exists
 * today: the formalization of the scaffold `zanix new <type>` has always produced, made an
 * explicit, resolvable, named preset instead of an implicit default with nothing else it could
 * ever be. This file (plus `recipe.ts`'s `ScaffoldRecipeRegistry`/`resolveRecipe`) is the whole
 * infrastructure a future *second* preset needs — deliberately not designed yet, since which real
 * use cases deserve one is a product decision, not an architecture one (see `ENGINEERING.md` §2).
 *
 * Adding preset #2 later, for a project type that has a Recipe registry (`server`'s own
 * `SERVER_RECIPES`, `space`'s `SPACE_RECIPES`, `app`'s `APP_RECIPES` — every type except `library`,
 * see its own `getLibrarySrcTree` doc for why):
 * 1. Widen `PresetName` below to include it.
 * 2. Add an entry to that project type's own `_RECIPES` registry — a list of `ScaffoldRecipeEntry`s,
 *    exactly like `base`'s own.
 * `library` has no registry to extend this way (a static JSR-fetched file, not decomposable
 * `plan<Name>` leaves) — a `library`-only preset would branch inside `getLibrarySrcTree`'s own
 * `assertKnownPreset` call instead.
 * Neither `assembleScaffold` (`recipe.ts`) nor any of the `generate/` generators' own `command.ts`
 * ever needs to change — every preset is *composition* (which `plan<Name>` calls, with what
 * arguments, in what shape), never new generation logic of its own.
 */
export type PresetName = 'base'

/** Every preset name that exists anywhere, for the single upfront validation `getZnxFolderTree`
 * (`projects/main.ts`) runs before building anything — the one check that covers every project
 * type, including `library`, the one type with no `ScaffoldRecipeRegistry` of its own to
 * double-check it downstream the way `server`/`space`/`app` each do (see `assertKnownPreset`'s own
 * doc for why `library` still needs its own direct call to this function too). */
export const KNOWN_PRESETS: readonly PresetName[] = ['base']

/**
 * Throws a plain `Error` (never `Deno.exit`/`this.throw` — this runs deep in tree-building code
 * with no `Commander` context; the `new/actions/*.ts` action that called down into it is what
 * catches this and re-throws via `this.throw`, same convention as `planHandler`'s own
 * unsupported-`--type` throw) if `preset` isn't in `knownPresets`.
 *
 * Called as the very first thing `getZnxFolderTree` does, before any tree is built for *any*
 * project type — the one check every type shares. `server`/`space`/`app` each additionally run
 * `resolveRecipe` (`recipe.ts`) against their own `ScaffoldRecipeRegistry`, a second, per-type check
 * — intentional defense in depth, not redundant: once a preset exists globally but only for *some*
 * project types, this function alone can't catch "known preset name, wrong project type," only a
 * per-type lookup can. `library` has no registry to run that second check against (its `mod.ts` is a
 * static JSR-fetched placeholder, not `plan<Name>`-generated content — see `getLibrarySrcTree`'s own
 * doc), so it calls this exact function a second time directly instead, with its own (today
 * identical) known-presets list — the same defense-in-depth role, without forcing a registry where
 * there's no decomposable content to register.
 */
export function assertKnownPreset(
  preset: string,
  knownPresets: readonly string[] = KNOWN_PRESETS,
): void {
  if (!knownPresets.includes(preset)) {
    throw new Error(
      `Unknown template '${preset}'. Supported templates: ${knownPresets.join(', ')}.`,
    )
  }
}
