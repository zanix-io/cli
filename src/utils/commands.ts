import type { ArgumentCommandOptions } from 'typings/commands.ts'
import { Commander } from 'cli'

/**
 * Function to create a basic command with argument actions
 */
export function baseArgumentActionCommand(
  this: Commander,
  options: ArgumentCommandOptions,
) {
  const { name, description, optionalArgs = [], requiredArgs = [], action } = options

  const optionalArguments = optionalArgs.map((arg) => `[${arg.toString()}:string]`).join(' ')
  const requiredArguments = requiredArgs.map((arg) => `<${arg.toString()}:string>`).join(' ')

  // A real `Commander` instance — not the bare `Command` cliffy's own `this.command(name)` would
  // otherwise create — so an action can still call `this.runCommand(...)`/`this.mountGroup(...)`
  // once `this` correctly refers to this leaf itself (see the `.action()` doc below) instead of
  // the pseudo-parent it was registered on.
  const leaf = new Commander()

  return this.command(name, leaf)
    .description(description)
    // Required arguments must come before optional ones in a positional argument declaration —
    // the reverse order is a malformed declaration the moment both are used together.
    .arguments(`${requiredArguments} ${optionalArguments}`.trim())
    // A regular function, not an arrow one: cliffy invokes this as
    // `this.settings.actionHandler?.call(this, options, ...args)` (`@cliffy/command@1.2.1`,
    // command.ts:2431) on the real leaf command it just created (e.g. `space`, not the `new`
    // pseudo-parent this factory itself was called with) — an arrow function would ignore that
    // and keep closing over the outer `this` instead.
    .action(function (options, ...args) {
      return action.call(this, options, ...args)
    })
}
