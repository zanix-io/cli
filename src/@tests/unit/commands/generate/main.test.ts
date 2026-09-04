import { assertThrows } from '@std/assert'
import generateCommand from 'commands/generate/main.ts'
import { Commander } from 'cli'

type ActionCommand = { settings: { actionHandler: () => void } }

Deno.test('generate command should throw when called without a sub-command', () => {
  const outer = new Commander()
  generateCommand.call(outer)

  const command = outer.getCommands()[0] as unknown as ActionCommand

  assertThrows(
    () => command.settings.actionHandler(),
    Error,
    "You must provide an artifact to generate for the 'generate' command.",
  )
})
