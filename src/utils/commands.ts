import type { ArgumentCommandOptions } from 'typings/commands.ts'
import type { Command } from '@cliffy/command'

/**
 * Function to create a basic command with argument actions
 */
export function baseArgumentActionCommand(
  this: Command,
  options: ArgumentCommandOptions,
) {
  const { name, description, optionalArgs = [], requiredArgs = [], action } = options

  const optionalArgumenst = optionalArgs.map((arg) => `[${arg.toString()}:string]`).join(' ')
  const requiredArguments = requiredArgs.map((arg) => `<${arg.toString()}:string>`).join(' ')

  return this.command(name)
    .description(description)
    .arguments(optionalArgumenst + ' ' + requiredArguments)
    .action((options, ...args) => {
      action.call(this, options, ...args)
    })
}
