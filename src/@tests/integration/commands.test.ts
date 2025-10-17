import { assert, assertEquals, assertExists } from '@std/assert'
import prepareCommand from 'commands/prepare/main.ts'
import buildCommand from 'commands/build/main.ts'
import newCommand from 'commands/new/main.ts'
import { Commander } from 'cli'

Deno.test('build command should be correctly defined', () => {
  const cwd = new Commander()
  buildCommand.call(cwd)

  const command = cwd.getCommands()[0]
  assertExists(command['desc'])
  assertEquals(command['_name'], 'build')
  assert(command['options'].length === 9)
  assertEquals(command['options'][0].name, 'input-file')
  assertEquals(command['options'][1].name, 'output-file')
  assertEquals(command['options'][2].name, 'platform')
  assertEquals(command['options'][3].name, 'external')
  assertEquals(command['options'][4].name, 'npm')
  assertEquals(command['options'][5].name, 'obfuscate')
  assertEquals(command['options'][6].name, 'use-worker')
  assertEquals(command['options'][7].name, 'no-minify')
  assertEquals(command['options'][8].name, 'no-bundle')
})

Deno.test('new command should be correctly defined', () => {
  const cwd = new Commander()
  newCommand.call(cwd)

  const command = cwd.getCommands()[0]
  assertExists(command['desc'])
  assertEquals(command['_name'], 'new')
  assert(command['options'].length === 0)

  const commands = command['commands']

  const app = commands.get('app')
  assertExists(app)
  assert(app['options'].length === 2)
  assertEquals(app['options'][0].name, 'template')
  assertEquals(app['options'][1].name, 'no-prepare')

  const server = commands.get('server')
  assertExists(server)
  assert(server['options'].length === 2)
  assertEquals(server['options'][0].name, 'template')
  assertEquals(server['options'][1].name, 'no-prepare')

  const library = commands.get('library')
  assertExists(library)
  assert(library['options'].length === 2)
  assertEquals(library['options'][0].name, 'template')
  assertEquals(library['options'][1].name, 'no-prepare')

  const project = commands.get('project')
  assertExists(project)
  assert(project['options'].length === 2)
  assertEquals(project['options'][0].name, 'template')
  assertEquals(project['options'][1].name, 'no-prepare')
})

Deno.test('prepare command should be correctly defined', () => {
  const cwd = new Commander()
  prepareCommand.call(cwd)

  const command = cwd.getCommands()[0]

  assertExists(command['desc'])
  assertEquals(command['_name'], 'prepare')

  assert(command['options'].length === 6)

  assertEquals(command['options'][0].name, 'project-type')
  assertEquals(command['options'][1].name, 'lint-files')
  assertEquals(command['options'][2].name, 'fmt-files')
  assertEquals(command['options'][3].name, 'use-pre-commit')
  assertEquals(command['options'][4].name, 'github')
  assertEquals(command['options'][5].name, 'editor')
})
