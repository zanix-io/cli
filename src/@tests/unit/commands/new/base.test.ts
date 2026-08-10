import { assertThrows } from '@std/assert'
import { baseNewCommand } from 'commands/new/base.ts'
import { Commander } from 'cli'

type ActionCommand = { actionHandler: () => void }

Deno.test('new command should throw when called without a sub-command', () => {
  const outer = new Commander()
  baseNewCommand.call(outer, {})

  const command = outer.getCommands()[0] as unknown as ActionCommand

  assertThrows(
    () => command.actionHandler(),
    Error,
    "You must provide at least one argument for the 'new' command.",
  )
})
