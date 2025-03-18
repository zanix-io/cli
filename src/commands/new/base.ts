import type { ArgumentCommandOptions } from 'typings/commands.ts'

import { baseArgumentActionCommand } from 'utils/commands.ts'
import { Commander } from 'cli'

/**
 * Function to create a basic command for `new`
 */
export function baseNewCommand(
  this: Commander,
  commands: Record<string, Omit<ArgumentCommandOptions, 'name'>>,
) {
  const cwd = new Commander()

  Object.entries(commands).forEach(([name, options]) => {
    baseArgumentActionCommand.call(cwd, { name, ...options })
      .option(
        '-t --template [template:string]',
        'Specifies the template to be used for the operation. Provide a valid template name as a string.',
        { default: 'base' },
      ).option(
        '--no-prepare [prepare:string]',
        'Specifies that the default prepare command should not be executed.',
      )
  })

  this.command('new', cwd).action(() => {
    cwd.throw(new Error("You must provide at least one argument for the 'new' command."))
  }).description('Create new Zanix projects from scratch.')
}
