import { assertThrows } from '@std/assert'
import generateCommand from 'commands/generate/main.ts'
import { Commander } from 'cli'

type ActionCommand = { actionHandler: () => void }

Deno.test('generate command should throw when called without a sub-command', () => {
  const outer = new Commander()
  generateCommand.call(outer)

  const command = outer.getCommands()[0] as unknown as ActionCommand

  assertThrows(
    () => command.actionHandler(),
    Error,
    "You must provide an artifact to generate for the 'generate' command.",
  )
})
