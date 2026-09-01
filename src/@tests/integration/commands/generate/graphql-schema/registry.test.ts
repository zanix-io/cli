import { assert, assertEquals, assertExists } from '@std/assert'
import generateCommand from 'commands/generate/main.ts'
import { Commander } from 'cli'

/**
 * Proves `graphql-schema` is actually wired into `zanix generate`'s real command tree via
 * `registry.ts` — not just present as a file, reachable through the real, unmocked
 * `generateCommand`/`generatorRegistry` registration path (same "is this artifact correctly
 * wired" shape `openapi/registry.test.ts` already applies to that generator, and
 * `integration/commands.test.ts` applies to `build`/`new`/`prepare`).
 */
Deno.test('generate graphql-schema command should be correctly registered and reachable', () => {
  const cwd = new Commander()
  generateCommand.call(cwd)

  const generate = cwd.getCommands()[0]
  const graphqlSchema = generate.settings.commands.get('graphql-schema')

  assertExists(graphqlSchema)
  assertExists(graphqlSchema.settings.description)
  assertEquals(graphqlSchema.settings.name, 'graphql-schema')
  // No --verify (its own output has zero imports, same reasoning `openapi` documents), no
  // --application/other narrowing — this generator has no options at all, only the shared
  // optional trailing `[root]` argument every generator accepts.
  assert(graphqlSchema.builder.options.length === 0)
})
