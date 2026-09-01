/**
 * `zanix new space --theme <theme>` — the visual-identity axis, independent of `--template` (see
 * `presets.ts`'s own doc for why the two compose freely rather than being one combined value).
 * `'default'` (`space-theme.ts`) copies `@zanix/space-ui`'s generic starter theme CSS into a
 * project-root `theme/` folder (a sibling of `assets/`/`src/`, deliberately outside `assetsDir`'s
 * own scan path — see `space-theme.ts`'s own doc for why) and wires it into `space.app.ts`'s
 * `globalCss`. `'astronaut'`
 * (`space-astronaut.ts`) is a distinct, complete dark "deep space" palette — same `globalCss`
 * mechanism, different source files, plus its own decorative CSS neither `'default'` nor
 * `--template welcome` alone ships. Omitting `--theme` entirely writes no `globalCss` field at
 * all — a plain, unstyled scaffold, same as today's behavior with no theme requested.
 *
 * Also the one axis `space.ts`'s own Comet-content selection reads (see that file's own doc): the
 * interactive "launch a comet" demo's CSS (`.comet-launch`/`.comet-launchpad`) lives exclusively in
 * `'astronaut'`'s own stylesheet, so that demo is written ONLY when `theme === 'astronaut'`,
 * regardless of `--template` — every other combination gets the plain generic counter Comet.
 *
 * Adding a future theme #N: widen `ThemeName`/`KNOWN_THEMES` below, add its own `copy<Name>Assets`/
 * `get<Name>GlobalCssPaths` module (mirroring `space-theme.ts`'s shape), and add one branch each to
 * `getSpaceAppTemplate`'s `globalCssPaths` selection and `ensureSpaceScaffoldSideEffects`'s own
 * theme-side-effect step (`space.ts`) — neither the recipe mechanism nor `assembleScaffold` itself
 * ever needs to change for this axis, same as `presets.ts`'s own extension procedure.
 */
export type ThemeName = 'default' | 'astronaut'

/** Every theme name that exists — the one check `getZnxFolderTree` (`projects/main.ts`) runs
 * before building anything, alongside `assertKnownPreset`. Only ever validated for `space`/
 * `space-server` (the only project types `--theme` applies to — see `main.ts`'s own doc); an
 * unset `--theme` is valid everywhere and never reaches this check at all. */
export const KNOWN_THEMES: readonly ThemeName[] = ['default', 'astronaut']

/**
 * Throws a plain `Error` (same never-`this.throw`-directly convention as `assertKnownPreset`) if
 * `theme` isn't in `knownThemes`. Called only when `--theme` was actually passed — `undefined`
 * (the default, "no theme requested") never reaches this function at all.
 */
export function assertKnownTheme(
  theme: string,
  knownThemes: readonly string[] = KNOWN_THEMES,
): void {
  if (!knownThemes.includes(theme)) {
    throw new Error(
      `Unknown theme '${theme}'. Supported themes: ${knownThemes.join(', ')}.`,
    )
  }
}
