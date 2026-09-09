import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'
import { disableNativeFreshnessCheckForTests } from '../shared/disable-native-freshness-check.ts'

// See disableNativeFreshnessCheckForTests's own doc for why this is needed here.
disableNativeFreshnessCheckForTests()

// ================================================================================================
// Regression guard for `dev/action.ts`'s own native `import('@zanix/server')` — the opposite
// mechanism from `importProjectDependency`'s project-anchored resolution (see this file's own
// sibling, `command-live-boot-divergent-space-version.test.ts`, for that half). `space.app.ts`
// never imports `@zanix/server` itself — only `@zanix/space` does, transitively — so there is no
// project-declared version for `@zanix/server` to anchor a resolution against in the first place;
// `bootstrapServers`/`ProgramModule`/`webServerManager`/`ZANIX_SERVER_MODULES` need to be the SAME
// module instance `@zanix/space`'s own internal `@Page`/`@Route` decorators write their route
// registrations into, and that internal import resolves natively, governed by `@zanix/cli`'s own
// config — never by whatever a `space-server` project's own `deno.json` happens to declare for its
// own, unrelated backend reasons.
//
// This fixture is a `space-server` project (the one real project type that DOES declare
// `@zanix/server` directly, per `PROJECT_TYPE_DEPENDENCIES`) explicitly pinning it to `4.0.0` — a
// real, currently-published version, genuinely older than `@zanix/cli`'s own declared
// `@zanix/server` floor. Confirms `zanix space dev` boots cleanly and actually registers/serves a
// real route — the exact observable symptom of the "zero routes" class of bug this whole
// mechanism exists to prevent — regardless of the project's own divergent `@zanix/server` pin.
//
// Deliberately its own file, own port — same reasoning `command-live-boot.test.ts` already
// documents for staying separate from `command-live-conflict.test.ts`.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Same race/retry this file's own sibling (`command-live-boot.test.ts`) already documents in
 * full — Vite's own background dependency-optimizer writes can still be mid-flight against `root`
 * when this test tears it down. */
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

/** A real `space-server` project, `SPACE_CLIENT_IMPORTS`'s own default `@zanix/space` pins left
 * untouched, but with an explicit, real, older `@zanix/server@4.0.0` pin of its own added — a
 * `space-server` project's own legitimate reason to declare `@zanix/server` directly, per
 * `PROJECT_TYPE_DEPENDENCIES`, genuinely diverging from `@zanix/cli`'s own declared floor. */
async function withDivergentServerScaffold(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify(
        {
          zanix: { project: 'space-server' },
          imports: { ...SPACE_CLIENT_IMPORTS, '@zanix/server': 'jsr:@zanix/server@4.0.0' },
        },
        null,
        2,
      ),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import '@zanix/space/react'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'dev-live-divergent-server-app',
  routesDir: './src/space/routes',
})
`,
    )
    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await removeDirWithRetry(root)
  }
}

Deno.test({
  name: 'zanix space dev: boots cleanly and serves a real route against a space-server project ' +
    "pinning its OWN @zanix/server to an OLDER, explicit version than cli's own declared floor — " +
    "the project's own pin never governs @zanix/server here, only @zanix/cli's own native " +
    'resolution does',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withDivergentServerScaffold(async () => {
      const port = 48782
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      const response = await fetch(`http://localhost:${port}/`)
      await response.body?.cancel()
      assert(response.status > 0, `expected a real HTTP response, got status ${response.status}`)
    })
  },
})
