import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// Regression guard for `spaceDevAction`'s own `src/server/` auto-discovery (`dev/action.ts`, the
// `getCurrentProjectType(root) === 'space-server'` block) — the fix for a `space-server` project's
// `zanix space dev` never running `@zanix/core`'s `defineCoreMetadata()`/`defineLocalMetadata()`
// (a real production `mod.ts`'s own `Zanix.start()` sequence, never invoked here — see
// `importSpaceApp`'s own doc for why).
//
// Deliberately its OWN test file, not folded into `command-live-boot.test.ts` — same reasoning
// that file already documents for itself (a real `bootstrapServers()` call must not share
// `@zanix/server`'s own process-wide boot-session state with another test file's call; Deno gives
// each test file its own module registry/worker).
//
// This test specifically exercises the SHARED-cache fix (`ImportBatchContext`,
// `import-project-module.ts`) — not `Zanix.compose()`'s own `defineCoreMetadata()` half, which is
// `@zanix/core`'s own tested responsibility, unreachable here without a real Mongo/Redis/AMQP
// instance to point `MONGO_URI`-style env vars at (out of scope for a real, CI-safe test). Without
// a SHARED cache, calling `importProjectModule` once per file independently discovered under
// `src/server/` would re-import a file reached BOTH directly (the scan's own entry) AND indirectly
// (via a sibling file's relative import) as a SECOND, independent module evaluation — see that
// type's own doc in `import-project-module.ts` for the full mechanism this closes.
//
// `marker.provider.ts` below deliberately carries no `@Provider` decorator at all — this test
// isolates the IMPORT-dedup mechanism itself, not DI container resolution (already covered,
// separately, by `@zanix/server`'s own `custom slot` tests). A real top-level side effect (a
// counter written to a real file on disk) is the observable signal: exactly ONE module evaluation
// of `marker.provider.ts` — reached three ways (the scan's own direct entry, plus TWO sibling
// files' relative imports) — increments it exactly once if the shared cache works, up to three
// times if it doesn't.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Same retry-past-Vite's-own-background-writes shape `command-live-boot.test.ts` already
 * documents in full for itself — duplicated here, not imported, for the same "each test file
 * deliberately separate" reasoning that file's own header doc gives. */
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

async function withDevServerScaffold(
  run: (root: string, markerHitsPath: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  const markerHitsPath = join(root, 'marker-hits.txt')
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify(
        { zanix: { project: 'space-server' }, imports: SPACE_CLIENT_IMPORTS },
        null,
        2,
      ),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import '@zanix/space/react'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'dev-live-space-server-app',
  routesDir: './src/space/routes',
})
`,
    )
    await Deno.mkdir(join(root, 'src/server/shared'), { recursive: true })
    await Deno.mkdir(join(root, 'src/server/handlers'), { recursive: true })
    // No `@Provider` decorator, deliberately — see this file's own header doc for why. The
    // top-level side effect IS the test: one real, observable increment per module evaluation.
    await Deno.writeTextFile(
      join(root, 'src/server/shared/marker.provider.ts'),
      `const MARKER_HITS_PATH = ${JSON.stringify(markerHitsPath)}
let current = 0
try {
  current = Number(Deno.readTextFileSync(MARKER_HITS_PATH))
} catch {
  // First evaluation — no file yet.
}
Deno.writeTextFileSync(MARKER_HITS_PATH, String(current + 1))

export class MarkerProvider {}
`,
    )
    // Two INDEPENDENT scan entries (both match \`.handler.ts\`, both discovered directly), each
    // ALSO relatively importing the SAME shared file — the exact shape this test exists to cover.
    await Deno.writeTextFile(
      join(root, 'src/server/handlers/a.handler.ts'),
      `export { MarkerProvider } from '../shared/marker.provider.ts'\n`,
    )
    await Deno.writeTextFile(
      join(root, 'src/server/handlers/b.handler.ts'),
      `export { MarkerProvider } from '../shared/marker.provider.ts'\n`,
    )
    Deno.chdir(root)
    await run(root, markerHitsPath)
  } finally {
    Deno.chdir(originalCwd)
    await removeDirWithRetry(root)
  }
}

Deno.test({
  name:
    "zanix space dev (space-server): a shared src/server/ file reached BOTH directly (the scan's " +
    "own entry) AND indirectly (via two sibling files' relative imports) evaluates EXACTLY ONCE " +
    '— never once per path that reaches it — proving the batch import dedup fix works',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withDevServerScaffold(async (_root, markerHitsPath) => {
      const port = 48773
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      const hits = await Deno.readTextFile(markerHitsPath)
      assertEquals(
        hits,
        '1',
        'marker.provider.ts was evaluated more than once — the shared ImportBatchContext failed ' +
          'to dedup it across independent src/server/ scan entries',
      )
    })
  },
})
