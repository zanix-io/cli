import type { ArgumentCommandOptions } from 'typings/commands.ts'

import { baseArgumentActionCommand } from 'utils/commands.ts'
import { Commander } from 'cli'

/**
 * A `baseNewCommand` entry, `rendererAware: true` for `space`/`spacecraft` only — the ONLY two
 * project types `@zanix/space` (and therefore a renderer choice) applies to. `--renderer` is
 * deliberately its own option, never a `--template` value: `ZanixTemplates` (`@zanix/types`) is a
 * single, cross-project-type union (`app`/`server`/`library`/`space`/`spacecraft` all share it) —
 * overloading it with a `space`-specific axis would leak that concept into project types that have
 * no renderer at all.
 *
 * `iconsAware: true`, same two project types, same reasoning — `--icons` (`@zanix/space-ui`'s
 * default icon catalog) is deliberately its own boolean option too, never a `--template` value.
 * Unlike `renderer`, `icons` has nothing to do with which renderer/subtree gets built — it's
 * independent of BOTH `--template` and `--renderer`/`--theme`, see `space-icons.ts`'s own doc for
 * why bundling it into a visual-theme value would be the wrong axis — confirmed real, not
 * speculative, now that both exist: `space-icons-independence.test.ts`/
 * `functional/space-theme-live.test.ts` prove `--icons` and `--theme` compose freely.
 *
 * `themeAware: true`, same two project types — `--theme` (`themes.ts`) is the visual-identity
 * axis, independent of `--template`: see `presets.ts`'s own doc for why the two compose freely
 * rather than being one combined value.
 *
 * `pagesAware: true`, same two project types — `--pages` (`space-pages.ts`) pre-seeds
 * `routes/error.tsx`/`routes/not-found.tsx` by reusing `zanix generate error`/
 * `zanix generate not-found`'s own template functions, independent of `--template`/`--theme`/
 * `--renderer`/`--icons` — off by default, same as `--icons`.
 */
type NewCommandEntry = Omit<ArgumentCommandOptions, 'name'> & {
  rendererAware?: boolean
  iconsAware?: boolean
  themeAware?: boolean
  pagesAware?: boolean
}

/**
 * Function to create a basic command for `new`
 */
export function baseNewCommand(
  this: Commander,
  commands: Record<string, NewCommandEntry>,
) {
  const cwd = new Commander()

  Object.entries(commands).forEach(
    ([name, { rendererAware, iconsAware, themeAware, pagesAware, ...options }]) => {
      const command = baseArgumentActionCommand.call(cwd, { name, ...options })
        .option(
          '-t --template [template:string]',
          'Specifies the template to be used for the operation. Provide a valid template name as a string.',
          { default: 'base' },
        ).option(
          '--no-prepare [prepare:string]',
          'Specifies that the default prepare command should not be executed.',
        ).option(
          '--verify',
          'Opt-in: after generating, run `deno check` against every file in the new project and ' +
            'warn (without failing) if it does not compile against the currently installed ' +
            'dependency versions. Off by default — generation stays local/instant unless requested.',
        )

      if (rendererAware) {
        command.option(
          '--renderer [renderer:string]',
          "Which renderer this @zanix/space app's Comets/pages are authored against: 'react' " +
            "(the default, full renderer — Suspense, streaming, full async semantics) or 'preact' " +
            '(a deliberately smaller, specialized renderer for Comets/islands and pages whose data ' +
            "resolves entirely inside their own loader — see @zanix/space's own README for the " +
            'full contract). Selects the renderer for the WHOLE project, never per-file.',
          { default: 'react' },
        )
      }

      if (iconsAware) {
        command.option(
          '--icons',
          "Scaffolds @zanix/space-ui's default icon catalog (a small, curated, Font Awesome " +
            'Free-sourced SVG sprite — see its own Styling Proposal) into assets/icons/, plus its ' +
            'NOTICE.md/LICENSES/. A plain asset your project owns outright, never a runtime ' +
            'dependency. Independent of --template/--theme — off by default, and works with any ' +
            'theme, a custom one, or none at all.',
        )
      }

      if (themeAware) {
        command.option(
          '--theme [theme:string]',
          "The visual identity to scaffold into theme/: 'default' (@zanix/space-ui's " +
            "generic starter palette) or 'astronaut' (a complete dark 'deep space' identity, " +
            'plus its own interactive Comet demo). Independent of --template — omit entirely for ' +
            'an unstyled scaffold.',
        )
      }

      if (pagesAware) {
        command.option(
          '--pages [pages:string]',
          'Comma-separated special pages to pre-seed: "error" (routes/error.tsx, an app-wide ' +
            'error boundary) and/or "not-found" (routes/not-found.tsx, the whole-app 404 view) — ' +
            'e.g. --pages=error,not-found. The exact same content `zanix generate error`/' +
            '`zanix generate not-found` would produce. Independent of --template/--theme/' +
            "--renderer/--icons — omit entirely to keep relying on @zanix/space's own built-in " +
            'fallback views.',
        )
      }
    },
  )

  this.mountGroup('new', cwd).action(() => {
    cwd.throw(
      new Error(
        "You must provide at least one argument for the 'new' command.",
      ),
    )
  }).description('Create new Zanix projects from scratch.')
}
