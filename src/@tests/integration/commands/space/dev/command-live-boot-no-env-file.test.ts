import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// `zanix space dev` boots normally for a project with no `.env` file at all — a missing file is
// never an error for `loadEnvFileVars` (`action.ts`), only ever a no-op. See
// `command-live-boot-env-file.test.ts`'s own header doc for the full mechanism and why this
// scenario lives in its own file rather than alongside that one.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Retries a request against a just-booted dev server a few times, a real cold-start race this
 * scenario (the only one of the three `command-live-boot-env-file*` files that actually sends a
 * request, rather than only reading `Deno.env`) exposed: `spaceDevAction`'s own "running at"
 * log fires as soon as the HTTP listener is registered, but Vite's own dependency optimizer can
 * still be mid-bundle on a cold cache at that exact moment, and the very first request in that
 * window gets a real, transient `Connection refused` rather than a queued/delayed response. */
async function fetchWithRetry(
  url: string,
  attempts = 10,
  delayMs = 200,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      return await fetch(url)
    } catch (error) {
      lastError = error
      // deno-lint-ignore no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

/** Same retry-past-Vite's-background-writes reasoning as `command-live-boot.test.ts`'s own
 * `removeDirWithRetry` — kept as an identical copy rather than a shared import, since these files
 * are deliberately isolated from each other. */
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

Deno.test({
  name: 'zanix space dev: boots normally with no .env file at all (degrades gracefully)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
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
  name: 'dev-live-app-no-env',
  routesDir: './src/space/routes',
})
`,
      )

      Deno.chdir(root)
      const port = 48777
      const command = registerCommand()
      // No `.env` written above — `loadEnvFileVars` reads nothing and boots exactly as it would
      // for a project that never declares one at all.
      await command.settings.actionHandler({ port })

      const response = await fetchWithRetry(`http://localhost:${port}/`)
      assert(response.status > 0)
      await response.body?.cancel()
    } finally {
      Deno.chdir(originalCwd)
      await removeDirWithRetry(root)
    }
  },
})
