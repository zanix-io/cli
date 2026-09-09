import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'
import { disableNativeFreshnessCheckForTests } from '../shared/disable-native-freshness-check.ts'

// See disableNativeFreshnessCheckForTests's own doc for why this is needed here.
disableNativeFreshnessCheckForTests()

// ================================================================================================
// `zanix space dev` exports a `space`/`space-server` project's own `.env` file into `Deno.env`
// before `space.app.ts` (or anything it imports) ever runs — via `--env-file <path>` (`command.ts`,
// defaulting to `.env`) and `loadEnvFileVars` (`action.ts`). `start`/`worker` (`getBaseTasks`,
// `utils/config/base.ts`) get this for free from their own `deno run --env-file=.env ...` task
// string; `zanix space dev` has no equivalent task-level flag to attach it to — it runs as a
// subcommand of the already-started `zanix`/`znx` binary, never a fresh `deno run <file>`
// invocation a generated task string controls — so `loadEnvFileVars` reads and exports the same
// file in-process instead, with the identical missing-file tolerance `--env-file=.env` already has
// for `start`/`worker`. `zanix new space`/`space-server`'s own generated `dev` task passes this
// flag explicitly (`deno install && zanix space dev --env-file=.env`, `getBaseTasks`).
//
// Deliberately its OWN file, one real dev-server boot only — same reasoning `command-live-boot.
// test.ts`'s own header doc already establishes: Deno gives each test FILE its own module
// registry/worker, so a real `bootstrapServers()` call here never shares `@zanix/server`'s own
// process-wide boot-session/`webServerManager` state (or Vite's own default HMR WebSocket port)
// with another live-boot test's call. `command-live-boot-env-file-custom-path.test.ts` and
// `command-live-boot-no-env-file.test.ts` cover the other two `.env`-loading scenarios, each in
// their own file for the identical reason.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
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

const ENV_VAR_NAME = 'ZANIX_SPACE_DEV_ENV_FILE_TEST_VAR'

Deno.test({
  name: "zanix space dev: loads and exports the project's own .env file, same as start/worker",
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
  name: 'dev-live-app',
  routesDir: './src/space/routes',
})
`,
      )
      await Deno.writeTextFile(join(root, '.env'), `${ENV_VAR_NAME}=from-dotenv\n`)

      assertEquals(Deno.env.get(ENV_VAR_NAME), undefined)

      Deno.chdir(root)
      const port = 48776
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      // Proves the fix reaches the real process env, not just some internal config object —
      // `Deno.env.get` is exactly what a dev-time loader/handler calls to read it.
      assert(
        Deno.env.get(ENV_VAR_NAME) === 'from-dotenv',
        `expected "${ENV_VAR_NAME}" to be exported from .env, got ${Deno.env.get(ENV_VAR_NAME)}`,
      )
    } finally {
      Deno.env.delete(ENV_VAR_NAME)
      Deno.chdir(originalCwd)
      await removeDirWithRetry(root)
    }
  },
})
