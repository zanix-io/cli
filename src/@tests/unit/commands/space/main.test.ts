import { assertThrows } from '@std/assert'
import spaceCommand from 'commands/space/main.ts'
import { Commander } from 'cli'

type ActionCommand = { actionHandler: () => void }

Deno.test('space command should throw when called without a sub-command', () => {
  const outer = new Commander()
  spaceCommand.call(outer)

  const command = outer.getCommands()[0] as unknown as ActionCommand

  assertThrows(
    () => command.actionHandler(),
    Error,
    "You must provide a subcommand for the 'space' command (e.g. 'dev'/'build').",
  )
})
