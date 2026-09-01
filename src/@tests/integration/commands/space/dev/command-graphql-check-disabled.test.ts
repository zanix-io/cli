import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

/**
 * `zanix space dev --no-graphql-check` — its own test FILE, deliberately separate from
 * `command-graphql-check-syntax-error.test.ts` (same broken-query scaffold, same technique) — see
 * that file's own doc for why: a second real `bootstrapServers()` call in the SAME file collides
 * on the first one's already-registered routes, even under a different port and Application name
 * once tried; `command-live-boot.test.ts` already established "each real boot needs its own file"
 * for this exact reason.
 *
 * @module
 */

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Same retry-past-Vite's-own-background-writes shape `command-live-boot.test.ts` already
 * documents in full — kept here rather than shared, matching that file's own "each real
 * `bootstrapServers()` call needs its own test FILE" reasoning (a separate module registry). */
async function removeDirWithRetry(path: string, attempts = 5, delayMs = 75): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.remove(path, { recursive: true })
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) lastError = error
    }
    // deno-lint-ignore no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.lstat(path)
    } catch {
      return
    }
  }
  throw lastError ?? new Error(`${path} still exists after ${attempts} removal attempts`)
}

async function withDevScaffold(
  gqlContent: string,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ zanix: { project: 'space' }, imports: SPACE_CLIENT_IMPORTS }, null, 2),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import '@zanix/space/react'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'dev-live-graphql-check-disabled-app',
  routesDir: './src/space/routes',
})
`,
    )
    await Deno.mkdir(join(root, 'src', 'space', 'gql'), { recursive: true })
    await Deno.writeTextFile(join(root, 'src', 'space', 'gql', 'users.gql.ts'), gqlContent)
    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await removeDirWithRetry(root)
  }
}

Deno.test({
  name: '--no-graphql-check disables the check in dev too — same broken query, still boots clean',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withDevScaffold(`export const BROKEN_QUERY = 'query ( {'\n`, async () => {
      const port = 48981
      const command = registerCommand()
      await command.settings.actionHandler({ port, graphqlCheck: false })

      const response = await fetch(`http://localhost:${port}/`)
      await response.body?.cancel()
      assert(response.status > 0, `expected a real HTTP response, got status ${response.status}`)
    })
  },
})
