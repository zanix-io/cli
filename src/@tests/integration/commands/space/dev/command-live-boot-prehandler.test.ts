import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// Real regression check for `getUserPreHandler`'s own dev/prod parity fix: before it, a
// `preHandler` a consumer declared (e.g. `@zanix/space`'s `langPreHandler`) only reached a
// production `mod.ts`'s own `bootstrapRemoteApp` call — `zanix space dev` never imports `mod.ts`
// at all, only `space.app.ts`, so that `preHandler` was invisible under `dev` entirely.
//
// Deliberately its OWN test file, not folded into `command-live-boot.test.ts` — that file's own
// doc already establishes why: two real `bootstrapServers()` boots in one file share process-wide
// state (confirmed there via a real port-bind failure; here, Vite's own hardcoded HMR WebSocket
// port collided across the two live dev engines instead — same underlying cross-test contamination,
// different symptom).
//
// Registers a raw `@zanix/server` `@SsrController` route directly in THIS file (not a real
// `@zanix/space` `page.tsx`, which `command-live-boot.test.ts`'s own doc already establishes is out
// of scope to reproduce here — Vite's SSR module graph resolves a scaffolded project's bare
// specifiers only against ITS OWN `deno.json`) — confirmed via a standalone repro that
// `bootstrapServersImpl` only ever creates/starts the `ssr` server type when it actually has
// something to serve; with the OTHER live-boot test's zero-page fixture, `ssr` never starts at all
// and `socket` (which always has a real route via `SpaceDevSocket`'s own `@Socket` import-time
// registration) ends up the only thing bound to the shared port — which would make ANY `preHandler`
// composition fix look broken even though it isn't. A real SSR route sidesteps that entirely.
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
 * `removeDirWithRetry` — kept as an identical copy rather than a shared import, since these two
 * files are deliberately isolated from each other (see this file's own header doc). */
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

// Registered once, at this file's own module-evaluation time — before `spaceDevAction` ever runs —
// so `bootstrapServersImpl` sees a real `ssr` route to serve and actually creates/starts that
// server type (see this file's own header doc for why that's required).
@SsrController()
class DummySsrRoute extends ZanixSsrController {
  @Get('dummy-marker-route')
  public hello() {
    return new Response('dummy-ok')
  }
}
void DummySsrRoute

Deno.test({
  name:
    'zanix space dev: composes a consumer-registered preHandler (definePreHandler) after its own ' +
    'Vite/asset handling',
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
      // `definePreHandler` must run at import time, from a module `space.app.ts` itself pulls in —
      // exactly the timing contract its own doc requires, and the one a real consumer would follow
      // (e.g. from their own `middleware.ts`, imported here inline instead only to keep this fixture
      // to one file).
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import '@zanix/space/react'
import { defineSpaceApp, definePreHandler } from '@zanix/space'

definePreHandler((req) =>
  new URL(req.url).pathname === '/preHandler-marker'
    ? new Response('handled-by-user-preHandler')
    : null
)

export default defineSpaceApp({
  // 'main' — matches \`DEFAULT_APPLICATION\` (\`@zanix/server\`) on purpose: this file's own
  // \`DummySsrRoute\` registers under the default Application (a plain \`@SsrController()\`, outside
  // \`@zanix/space\`'s own \`ProgramModule.defineApplication\` scoping), so this app's own \`ssr\`
  // server (scoped to \`bootstrapServers({ ssr: { application: appName } })\`) needs to share that
  // same Application to see it as "something to serve" and actually start at all.
  name: 'main',
  routesDir: './src/space/routes',
})
`,
      )
      Deno.chdir(root)
      const port = 48773
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      // The registered preHandler intercepts its own marker path before route matching — proves
      // `getUserPreHandler()` is actually being composed into this dev server's own `preHandler`
      // chain, not just registered-but-ignored.
      const handled = await fetch(`http://localhost:${port}/preHandler-marker`)
      assert(
        handled.status === 200,
        `expected the user preHandler to answer, got ${handled.status}`,
      )
      assert(await handled.text() === 'handled-by-user-preHandler')

      // A path the preHandler itself lets fall through (returns `null`) still reaches normal
      // dispatch — proves composition, not a full hijack of every request. Hits the real SSR route
      // registered above (`DummySsrRoute`), which is also what makes `ssr` actually start in the
      // first place — see this file's own header doc.
      const untouched = await fetch(`http://localhost:${port}/dummy-marker-route`)
      assert(untouched.status === 200)
      assert(await untouched.text() === 'dummy-ok')
    } finally {
      Deno.chdir(originalCwd)
      await removeDirWithRetry(root)
    }
  },
})
