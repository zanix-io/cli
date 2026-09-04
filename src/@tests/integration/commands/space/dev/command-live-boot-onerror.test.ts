import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { Get, SsrController, ZanixSsrController } from '@zanix/server'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// Real regression check for TWO stacked fixes in `dev/action.ts`:
//
// 1. The `ssr` options object is now spread from `bootstrapConfig.server?.ssr` (was previously
//    hand-written with no spread at all) — so a consumer's `defineBootstrapSpaceAppConfig({
//    server: { ssr: { onError, ... } } })` registration is no longer silently dropped.
//
// 2. That alone still wasn't enough: `zanix space dev` forces `rest`/`ssr`/`socket` to share ONE
//    port, and `@zanix/server` only applies `Deno.serve()` options from the FIRST server type to
//    bind a shared port (`rest`, per its own fixed `rest → socket → graphql → ssr` registration
//    order) — every LATER type sharing that port just reuses the address, and none of ITS OWN
//    `opts` (`onError` included) ever reach the real listener. `onError`/`attachRequestToErrors`
//    registered under `server.ssr` (exactly what every generated `space.app.ts` now does —
//    `getSpaceAppTemplate`'s own doc) are therefore also forwarded onto `rest`'s own config in
//    `dev/action.ts`, since `rest` is the one whose options actually win.
//
// Without BOTH fixes, a registered `onError: createNotFoundHandler()` never fires for a genuinely
// unmatched route under `zanix space dev` — confirmed live, not hypothetical: a real user project
// with this exact wiring still returned raw JSON for a 404 under `dev` after fix #1 alone.
//
// Same isolation/fixture conventions as `command-live-boot-prehandler.test.ts` (its own file's
// header doc explains why this needs its own real `@SsrController` route and its own file).
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
    'zanix space dev: a consumer-registered onError (defineBootstrapSpaceAppConfig({ server: { ' +
    'ssr: { onError } } })) actually fires for an unmatched route, despite rest/ssr/socket ' +
    'sharing one port under dev',
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
import { defineSpaceApp, defineBootstrapSpaceAppConfig } from '@zanix/space'

defineBootstrapSpaceAppConfig({
  server: {
    ssr: {
      // Any error reaching this handler at all (regardless of shape — this fixture only cares
      // whether it's ever CALLED, not which real error class \`@zanix/server\` throws for a 404)
      // proves \`rest\`'s own opts (the ones that actually win the shared port under dev) now
      // carry this registration through.
      onError: () => Promise.resolve(new Response('handled-by-user-onError', { status: 404 })),
      attachRequestToErrors: true,
    },
  },
})

export default defineSpaceApp({
  // 'main' — matches \`DEFAULT_APPLICATION\` (\`@zanix/server\`) on purpose: this file's own
  // \`DummySsrRoute\` registers under the default Application, so this app's own \`ssr\` server
  // needs to share that same Application to see it as "something to serve" and actually start.
  name: 'main',
  routesDir: './src/space/routes',
})
`,
      )
      Deno.chdir(root)
      const port = 48775
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      // A genuinely unmatched route reaches the registered onError.
      const notFound = await fetch(`http://localhost:${port}/this-route-does-not-exist`)
      const notFoundBody = await notFound.text()
      assert(
        notFound.status === 404,
        `expected 404, got ${notFound.status}, body: ${notFoundBody}`,
      )
      assert(notFoundBody === 'handled-by-user-onError', notFoundBody)

      // The real SSR route still dispatches normally — proves this isn't hijacking every request.
      const untouched = await fetch(`http://localhost:${port}/dummy-marker-route`)
      assert(untouched.status === 200)
      assert(await untouched.text() === 'dummy-ok')
    } finally {
      Deno.chdir(originalCwd)
      await removeDirWithRetry(root)
    }
  },
})
