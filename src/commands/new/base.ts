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
 */
type NewCommandEntry = Omit<ArgumentCommandOptions, 'name'> & { rendererAware?: boolean }

/**
 * Function to create a basic command for `new`
 */
export function baseNewCommand(
  this: Commander,
  commands: Record<string, NewCommandEntry>,
) {
  const cwd = new Commander()

  Object.entries(commands).forEach(([name, { rendererAware, ...options }]) => {
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
  })

  this.mountGroup('new', cwd).action(() => {
    cwd.throw(
      new Error(
        "You must provide at least one argument for the 'new' command.",
      ),
    )
  }).description('Create new Zanix projects from scratch.')
}
