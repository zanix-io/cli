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
// `zanix space dev --env-file <path>` loads the NAMED file instead of the default `.env` — see
// `command-live-boot-env-file.test.ts`'s own header doc for the full `loadEnvFileVars` mechanism
// and why this scenario lives in its own file rather than alongside that one (each real dev-server
// boot needs its own file, per `command-live-boot.test.ts`'s own established reasoning).
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

const CUSTOM_ENV_VAR_NAME = 'ZANIX_SPACE_DEV_CUSTOM_ENV_FILE_TEST_VAR'
const DEFAULT_ENV_VAR_NAME = 'ZANIX_SPACE_DEV_DEFAULT_ENV_FILE_TEST_VAR'

Deno.test({
  name: 'zanix space dev --env-file <path>: loads the NAMED file instead of the default .env, ' +
    'when one is passed',
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
  name: 'dev-live-app-custom-env',
  routesDir: './src/space/routes',
})
`,
      )
      // A default `.env` also present, with its OWN var — proves passing `--env-file` doesn't
      // just ADD the named file on top of the default, it replaces which one gets loaded.
      await Deno.writeTextFile(join(root, '.env'), `${DEFAULT_ENV_VAR_NAME}=from-default-env\n`)
      await Deno.writeTextFile(
        join(root, '.env.local'),
        `${CUSTOM_ENV_VAR_NAME}=from-custom-env-file\n`,
      )

      Deno.chdir(root)
      const port = 48778
      const command = registerCommand()
      await command.settings.actionHandler({ port, envFile: '.env.local' })

      assert(
        Deno.env.get(CUSTOM_ENV_VAR_NAME) === 'from-custom-env-file',
        `expected "${CUSTOM_ENV_VAR_NAME}" to be exported from .env.local, got ` +
          `${Deno.env.get(CUSTOM_ENV_VAR_NAME)}`,
      )
      assertEquals(Deno.env.get(DEFAULT_ENV_VAR_NAME), undefined)
    } finally {
      Deno.env.delete(CUSTOM_ENV_VAR_NAME)
      Deno.env.delete(DEFAULT_ENV_VAR_NAME)
      Deno.chdir(originalCwd)
      await removeDirWithRetry(root)
    }
  },
})
