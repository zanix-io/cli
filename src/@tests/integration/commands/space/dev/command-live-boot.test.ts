import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// `spaceDevAction`'s own real orchestration, end to end — the ONE thing `command.test.ts` itself
// says no test anywhere exercises (see that file's own doc): importing a real `space.app.ts`,
// creating a real `SpaceDevEngine` (a real Vite dev server, middleware-mode), activating the app
// (real `loadRoutes`), running validation, and booting REAL `bootstrapServers` listeners.
//
// Deliberately its OWN test file, not folded into `command-live-conflict.test.ts` — same reasoning
// `command-renderer.test.ts` (under `space/build`) already documents for itself: Deno gives each
// test FILE its own module registry/worker, so this file's real `bootstrapServers()` call never
// shares `@zanix/server`'s own process-wide boot-session/`webServerManager` state with that other
// file's own call (confirmed empirically: run back to back in ONE file, the second call's real
// port-bind failure stopped reproducing — a cross-test framework-state artifact, not something a
// real, separate `zanix space dev` invocation would ever hit).
//
// Deliberately zero route files. A real page (`@Page()` + `SpacePageController`) imports
// `@zanix/space`, and Vite's own SSR module graph — unlike `import-space-app.ts`'s plain
// `import()`, which Deno resolves against THIS repo's own `deno.jsonc` — resolves a scaffolded
// project's bare specifiers only against THAT project's own `deno.json`, never walking into
// `@zanix/space`'s own package-local import map (`modules/...`) the way Deno's native resolver
// does for a local path dependency. Reproducing that whole nested map here just to render one page
// would be testing `@zanix/space`'s own Vite integration, not this command — squarely out of
// scope (this file's own doc already states no dev-mode end-to-end test exists anywhere, for the
// same "real, live infrastructure" reason). `loadRoutes` tolerates zero pages the same way
// `command-empty-app.test.ts` already establishes for `zanix space build`.
//
// This never exits on its own (`command.ts`'s own doc: "nothing here stops them, since exiting is
// the user's own Ctrl+C") — disabling Deno's sanitizers below is the same precedent
// `src/@tests/unit/commands/build/main.test.ts` already uses for a real background compile that
// outlives its own test tick.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/**
 * Removes `path` recursively, retrying past a benign race against Vite's own background
 * dependency-optimizer writes (`.vite/deps_temp_*`, written from `onCrawlEnd` → `commitProcessing`
 * in Vite's own source) — the optimizer can still be mid-write against `root` when `withDevScaffold`
 * below tears it down. Confirmed empirically across 15 back-to-back runs of the test in this file: a
 * plain, single-attempt `Deno.remove` threw zero errors, yet still left 3 fully-populated
 * `.vite/deps_temp_*` trees behind afterwards — the optimizer recreated the whole subtree moments
 * after a clean removal, not mid-removal. A short existence check after each attempt catches that
 * resurrection; a bare catch-and-retry (the shape `prepare/docker.test.ts`'s own
 * `removeDirWithRetry` already uses for a similar, but throw-only, race) would not.
 */
async function removeDirWithRetry(path: string, attempts = 5, delayMs = 75): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.remove(path, { recursive: true })
    } catch (error) {
      // A `NotFound` here just means an earlier attempt in this same loop already removed it —
      // not a real failure.
      if (!(error instanceof Deno.errors.NotFound)) lastError = error
    }
    // Give any in-flight background write a moment to settle, then confirm the removal actually
    // stuck instead of trusting a clean `Deno.remove` call blindly.
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

/** Real `space.app.ts`, importing a renderer entry point explicitly — `defineSpaceApp`'s own
 * `setup()` (run unconditionally by `activateApps`, regardless of whether the project has any
 * pages) throws unless one of `@zanix/space/react`/`@zanix/space/preact` was imported somewhere
 * first — `@zanix/space` ships no renderer implementation at all. Matches what `zanix new
 * space`/`space-server`'s own template now writes (`getSpaceAppTemplate`, `commands/new/lib/tree/
 * projects/space.ts`) — always as the first import, ahead of `defineSpaceApp` itself. */
async function withDevScaffold(
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
  name: 'dev-live-app',
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
  name:
    'zanix space dev: real end-to-end boot — imports space.app.ts, activates the app, runs static ' +
    'validation, and starts a real SSR server that actually answers a request',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withDevScaffold(async () => {
      const port = 48771
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      // No routes registered — a real 404 is still a real response from a real, listening server;
      // this is proof `bootstrapServers` actually bound the port and is dispatching requests, not
      // a claim about how a real page renders (`@zanix/space`'s own concern, its own test suite).
      const response = await fetch(`http://localhost:${port}/`)
      await response.body?.cancel()
      assert(response.status > 0, `expected a real HTTP response, got status ${response.status}`)

      // `spaceDevAction`'s own `self.addEventListener('unload', ...)` closure is deliberately never
      // triggered here: the real event only fires at actual process exit (which a test suite never
      // reaches on its own), and manually dispatching a synthetic 'unload' was tried and reverted —
      // it left a process-wide listener behind that misfired against unrelated later tests. Not
      // worth that cross-test fragility for one closure's own function coverage.
    })
  },
})
