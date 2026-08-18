import { assertThrows } from '@std/assert'
import prepareCommand from 'commands/prepare/main.ts'
import { Commander } from 'cli'

type ActionCommand = {
  actionHandler: (
    options: { editor?: unknown; github?: unknown; docker?: unknown },
  ) => void
}

Deno.test('prepare command should throw when no editor/github/docker option is provided', () => {
  const cwd = new Commander()
  prepareCommand.call(cwd)

  const command = cwd.getCommands()[0] as unknown as ActionCommand

  assertThrows(
    () =>
      command.actionHandler({
        editor: undefined,
        github: undefined,
        docker: undefined,
      }),
    Error,
    "You must provide at least one option for the 'prepare' command.",
  )
})

Deno.test('prepare command should not throw when at least one option is provided', () => {
  const cwd = new Commander()
  prepareCommand.call(cwd)

  const command = cwd.getCommands()[0] as unknown as ActionCommand
  command.actionHandler({
    editor: 'vscode',
    github: undefined,
    docker: undefined,
  })
})

Deno.test('prepare command should not throw when only docker is provided', () => {
  const cwd = new Commander()
  prepareCommand.call(cwd)

  const command = cwd.getCommands()[0] as unknown as ActionCommand
  command.actionHandler({ editor: undefined, github: undefined, docker: true })
})
