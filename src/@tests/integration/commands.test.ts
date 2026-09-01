import { assert, assertEquals, assertExists, assertThrows } from '@std/assert'
import prepareCommand from 'commands/prepare/main.ts'
import buildCommand from 'commands/build/main.ts'
import newCommand from 'commands/new/main.ts'
import reportIssueCommand from 'commands/report-issue/main.ts'
import checkCyclesCommand from 'commands/check-cycles/main.ts'
import credentialsCommand from 'commands/credentials/main.ts'
import { DEFAULT_REPO } from 'commands/report-issue/lib/github-issue.ts'
import { Commander } from 'cli'

Deno.test('build command should be correctly defined', () => {
  const cwd = new Commander()
  buildCommand.call(cwd)

  const command = cwd.getCommands()[0]
  assertExists(command.settings.description)
  assertEquals(command.settings.name, 'build')
  assert(command.builder.options.length === 9)
  assertEquals(command.builder.options[0].name, 'input-file')
  assertEquals(command.builder.options[1].name, 'output-file')
  assertEquals(command.builder.options[2].name, 'platform')
  assertEquals(command.builder.options[3].name, 'external')
  assertEquals(command.builder.options[4].name, 'npm')
  assertEquals(command.builder.options[5].name, 'obfuscate')
  assertEquals(command.builder.options[6].name, 'use-worker')
  assertEquals(command.builder.options[7].name, 'no-minify')
  assertEquals(command.builder.options[8].name, 'no-bundle')
})

Deno.test('new command should be correctly defined', () => {
  const cwd = new Commander()
  newCommand.call(cwd)

  const command = cwd.getCommands()[0]
  assertExists(command.settings.description)
  assertEquals(command.settings.name, 'new')
  assert(command.builder.options.length === 0)

  const commands = command.settings.commands

  const space = commands.get('space')
  assertExists(space)
  assert(space.builder.options.length === 7)
  assertEquals(space.builder.options[0].name, 'template')
  assertEquals(space.builder.options[1].name, 'no-prepare')
  assertEquals(space.builder.options[2].name, 'verify')
  assertEquals(space.builder.options[3].name, 'renderer')
  assertEquals(space.builder.options[4].name, 'icons')
  assertEquals(space.builder.options[5].name, 'theme')
  assertEquals(space.builder.options[6].name, 'pages')

  const server = commands.get('server')
  assertExists(server)
  assert(server.builder.options.length === 3)
  assertEquals(server.builder.options[0].name, 'template')
  assertEquals(server.builder.options[1].name, 'no-prepare')
  assertEquals(server.builder.options[2].name, 'verify')

  const library = commands.get('library')
  assertExists(library)
  assert(library.builder.options.length === 3)
  assertEquals(library.builder.options[0].name, 'template')
  assertEquals(library.builder.options[1].name, 'no-prepare')
  assertEquals(library.builder.options[2].name, 'verify')

  const spacecraft = commands.get('spacecraft')
  assertExists(spacecraft)
  assert(spacecraft.builder.options.length === 7)
  assertEquals(spacecraft.builder.options[0].name, 'template')
  assertEquals(spacecraft.builder.options[1].name, 'no-prepare')
  assertEquals(spacecraft.builder.options[2].name, 'verify')
  assertEquals(spacecraft.builder.options[3].name, 'renderer')
  assertEquals(spacecraft.builder.options[4].name, 'icons')
  assertEquals(spacecraft.builder.options[5].name, 'theme')
  assertEquals(spacecraft.builder.options[6].name, 'pages')
})

Deno.test('prepare command should be correctly defined', () => {
  const cwd = new Commander()
  prepareCommand.call(cwd)

  const command = cwd.getCommands()[0]

  assertExists(command.settings.description)
  assertEquals(command.settings.name, 'prepare')

  assert(command.builder.options.length === 7)

  assertEquals(command.builder.options[0].name, 'project-type')
  assertEquals(command.builder.options[1].name, 'lint-files')
  assertEquals(command.builder.options[2].name, 'fmt-files')
  assertEquals(command.builder.options[3].name, 'hooks-engine')
  assertEquals(command.builder.options[4].name, 'github')
  assertEquals(command.builder.options[5].name, 'editor')
  assertEquals(command.builder.options[6].name, 'docker')
})

Deno.test('report-issue command should be correctly defined', () => {
  const cwd = new Commander()
  reportIssueCommand.call(cwd)

  const command = cwd.getCommands()[0]
  assertExists(command.settings.description)
  assertEquals(command.settings.name, 'report-issue')
  assert(command.builder.options.length === 5)
  assertEquals(command.builder.options[0].name, 'repo')
  assertEquals(command.getOption('repo')?.default, DEFAULT_REPO)
  assertEquals(command.builder.options[1].name, 'title')
  assertEquals(command.builder.options[2].name, 'body')
  assertEquals(command.builder.options[3].name, 'body-file')
  assertEquals(command.builder.options[4].name, 'label')
})

Deno.test('check-cycles command should be correctly defined', () => {
  const cwd = new Commander()
  checkCyclesCommand.call(cwd)

  const command = cwd.getCommands()[0]
  assertExists(command.settings.description)
  assertEquals(command.settings.name, 'check-cycles')
  assert(command.builder.options.length === 1)
  assertEquals(command.builder.options[0].name, 'path')
  assertEquals(command.getOption('path')?.default, '.')
})

Deno.test(
  'credentials command should be correctly defined, with real "mesh"/"password-hash" subcommands',
  () => {
    const cwd = new Commander()
    credentialsCommand.call(cwd)

    const command = cwd.getCommands()[0]
    assertExists(command.settings.description)
    assertEquals(command.settings.name, 'credentials')
    assert(command.builder.options.length === 0)

    const mesh = command.settings.commands.get('mesh')
    assertExists(mesh)
    assertExists(mesh.settings.description)
    assert(mesh.builder.options.length === 0)

    const passwordHash = command.settings.commands.get('password-hash')
    assertExists(passwordHash)
    assertExists(passwordHash.settings.description)
    assert(passwordHash.builder.options.length === 2)
  },
)

Deno.test('credentials command should throw when called without a sub-command', () => {
  const cwd = new Commander()
  credentialsCommand.call(cwd)

  const command = cwd.getCommands()[0] as unknown as {
    settings: { actionHandler: () => void }
  }

  assertThrows(
    () => command.settings.actionHandler(),
    Error,
    "You must provide a subcommand for the 'credentials' command (e.g. 'mesh', 'password-hash').",
  )
})
