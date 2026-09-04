/**
 * `zanix new --template <preset>` — the whole-project-type preset axis, ROUTE/PAGE CONTENT only.
 * `'base'` is the default scaffold `zanix new <type>` produces; `'welcome'` (`space`/`spacecraft`
 * only, via `SPACE_RECIPES` — see `space-welcome.ts`) adds a real welcome landing page in place of
 * the generic `Example` route. `'population'`/`'population-lang'` (same registry, see
 * `space-population.ts`) add a real, working i18n/population reference — `populationGuard()` alone
 * for `'population'`, plus `langPreHandler`/`langGuard` and `/[lang]/...` routing for
 * `'population-lang'` — two known, mutually-exclusive values rather than composable
 * `--use-lang`/`--use-population` flags: i18n's own URL structure/guard ordering is a real
 * architectural commitment a project either has or doesn't, not something safely sprinkled onto
 * every other preset/flag combination. All four compose through this file's own
 * `PresetName`/`KNOWN_PRESETS` and `recipe.ts`'s `ScaffoldRecipeRegistry`/`resolveRecipe` — neither
 * mechanism carries any preset-specific logic of its own.
 *
 * Visual identity is a SEPARATE, independent axis — `--theme <theme>` (`themes.ts`), never a
 * `--template` value. `--template`/`--theme` compose freely, in any combination: `--template
 * welcome --theme astronaut` gets both the richer welcome copy and the dark palette; `--template
 * base --theme astronaut` gets the generic `Example` page but still the astronaut theme (and its
 * own interactive Comet demo, since that's theme-owned too — see `space.ts`'s own doc for exactly
 * which axis owns what).
 *
 * Adding a future preset #N, for a project type that has a Recipe registry (`server`'s own
 * `SERVER_RECIPES`, `space`'s `SPACE_RECIPES`, `app`'s `APP_RECIPES` — every type except `library`,
 * see its own `getLibrarySrcTree` doc for why):
 * 1. Widen `PresetName` below to include it.
 * 2. Add an entry to that project type's own `_RECIPES` registry — a list of `ScaffoldRecipeEntry`s,
 *    exactly like `base`'s own (`welcome`'s own `SPACE_RECIPE_WELCOME` in `space.ts` is the real,
 *    worked example to copy the shape from).
 * `library` has no registry to extend this way (its single `ScaffoldRecipeEntry`, defined inline
 * inside `getLibrarySrcTree` itself since it needs the real project name rather than a subfolder's
 * `folder`, has nothing to select a second variant of yet) — a `library`-only preset would branch
 * inside `getLibrarySrcTree`'s own `assertKnownPreset` call instead.
 * Neither `assembleScaffold` (`recipe.ts`) nor any of the `generate/` generators' own `command.ts`
 * ever needs to change for the mechanism itself — most presets are pure *composition* (which
 * `plan<Name>` calls, with what arguments, in what shape). `'welcome'` is the one deliberate,
 * documented exception to that (see `space-welcome.ts`'s own doc): a real landing page needs real,
 * new markup, not just a different arrangement of an existing `plan<Name>`'s output.
 */
export type PresetName = 'base' | 'welcome' | 'population' | 'population-lang'

/** Every preset name that exists anywhere, for the single upfront validation `getZnxFolderTree`
 * (`projects/main.ts`) runs before building anything — the one check that covers every project
 * type, including `library`, the one type with no `ScaffoldRecipeRegistry` of its own to
 * double-check it downstream the way `server`/`space`/`app` each do (see `assertKnownPreset`'s own
 * doc for why `library` still needs its own direct call to this function too, even though its
 * content generation now goes through the same `assembleScaffold` mechanism as the other three).
 * `'welcome'`/`'population'`/`'population-lang'` have REAL, distinct behavior only for
 * `SPACE_RECIPES` (`space`/`space-server` — `spacecraft` shares `getSpaceSrcTree`) — `SERVER_RECIPES`
 * also registers all three, but only as a deliberate alias for its own `base` (`server.ts`'s own doc
 * explains why: `space-server`'s server half needs every space-only `--template` value to resolve
 * too, even though none of the three has anything server-specific to say). `app`/`library` still
 * only resolve `'base'` against their own registries, so any of these three still fails against
 * either of those, the same way an unknown name always has (`resolveRecipe`'s own per-type check,
 * defense in depth beyond this global
 * list). */
export const KNOWN_PRESETS: readonly PresetName[] = [
  'base',
  'welcome',
  'population',
  'population-lang',
]

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
 * per-type lookup can. `library` has no registry to run that second check against (its single
 * `ScaffoldRecipeEntry` is defined inline inside `getLibrarySrcTree` itself, not registered against
 * a `ScaffoldRecipeRegistry` — see that function's own doc), so it calls this exact function a
 * second time directly instead, with its own (today identical) known-presets list — the same
 * defense-in-depth role, without forcing a registry where there's only ever one entry to register.
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
