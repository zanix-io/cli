import { assert, assertEquals, assertExists } from '@std/assert'
import generateCommand from 'commands/generate/main.ts'
import { Commander } from 'cli'

/**
 * Proves `openapi` is actually wired into `zanix generate`'s real command tree via
 * `registry.ts` — not just present as a file, reachable through the real, unmocked
 * `generateCommand`/`generatorRegistry` registration path (same "is this artifact correctly
 * wired" shape `integration/commands.test.ts` already applies to `build`/`new`/`prepare`).
 */
Deno.test('generate openapi command should be correctly registered and reachable', () => {
  const cwd = new Commander()
  generateCommand.call(cwd)

  const generate = cwd.getCommands()[0]
  const openapi = generate.settings.commands.get('openapi')

  assertExists(openapi)
  assertExists(openapi.settings.description)
  assertEquals(openapi.settings.name, 'openapi')
  assert(openapi.builder.options.length === 2)
  assertEquals(openapi.builder.options[0].name, 'application')
  assertEquals(openapi.builder.options[1].name, 'include-admin')
})
