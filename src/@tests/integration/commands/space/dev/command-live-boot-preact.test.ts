import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// `command-live-boot.test.ts`'s own `renderer: 'preact'` counterpart — real, live proof that
// `importProjectDependency`'s project-anchored resolution (`@zanix/server`/`@zanix/space/dev`/
// `@zanix/app`/`@zanix/app/runtime`, none of them renderer-specific) boots identically regardless
// of which renderer the served project declares, matching `command-renderer.test.ts`'s own
// equivalent proof for `zanix space build`. `@zanix/space/react`/`@zanix/space/preact` are separate
// subpaths a project's own `space.app.ts` imports directly — resolved through the unrelated,
// unmodified `importProjectModule`/`resolveReplacement` path, never through
// `importProjectDependency` — so this is real coverage of a genuinely separate code path, not a
// duplicate of the React case.
//
// Deliberately its OWN test file, own port — same reasoning `command-live-boot.test.ts` already
// documents for staying separate from `command-live-conflict.test.ts`, and `command-renderer.test.ts`
// documents for keeping a `preact()` build isolated from a `react()` one: each test file gets its
// own module registry, so a real `bootstrapServers()`/Rolldown-binding call here never shares
// process-wide state with another file's own call.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Same race/retry `command-live-boot.test.ts` already documents in full — Vite's own background
 * dependency-optimizer writes can still be mid-flight against `root` when this test tears it down. */
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

/** Same real `space.app.ts` shape `command-live-boot.test.ts` uses, `renderer: 'preact'` instead —
 * `import '@zanix/space/preact'` first, same reason that file's own doc gives for `/react`:
 * `defineSpaceApp`'s own `setup()` throws unless a renderer implementation was imported somewhere
 * first, and `@zanix/space` ships none of its own. */
async function withPreactDevScaffold(
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
      `import '@zanix/space/preact'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'dev-live-preact-app',
  routesDir: './src/space/routes',
  renderer: 'preact',
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
    "zanix space dev: real end-to-end boot with renderer: 'preact' — proves importProjectDependency's " +
    'project-anchored resolution (none of it renderer-specific) works identically to the react case',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withPreactDevScaffold(async () => {
      const port = 48791
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      // Same "no routes, still a real listening server" proof `command-live-boot.test.ts` uses —
      // this is about the dev-engine bootstrap itself, not about rendering a real preact page.
      const response = await fetch(`http://localhost:${port}/`)
      await response.body?.cancel()
      assert(response.status > 0, `expected a real HTTP response, got status ${response.status}`)
    })
  },
})
