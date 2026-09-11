import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'
import { disableNativeFreshnessCheckForTests } from '../shared/disable-native-freshness-check.ts'

// See disableNativeFreshnessCheckForTests's own doc for why this is needed here.
disableNativeFreshnessCheckForTests()

// ================================================================================================
// Real end-to-end coverage for the scenario `command-live-boot-onerror.test.ts` (this same folder)
// deliberately doesn't reach: a class-level `@Guard`-thrown `401` on a real, MATCHED SSR page —
// never an unmatched/404 route — redirected via `@zanix/space`'s own `globalErrorHandler` composed
// with `@zanix/auth`'s own `redirectUnauthenticatedPageVisit`, under `zanix space dev`'s shared-port
// dispatch (`rest`/`ssr`/`socket` all bound to one port, `ssr` registered with no prefix as the
// catch-all, `rest` as `'api'`).
//
// Uses `@zanix/auth`'s own real `deriveSessionToken` (not a hand-rolled stub) — the same building
// block `pageSessionGuard` itself is built on — which already throws exactly
// `HttpError('UNAUTHORIZED')` the moment no session cookie is presented at all (see
// `resolveVerifiedRefreshToken`'s `if (!currentRefreshToken) throw error`), so a request with no
// session cookie reaches this without needing any `JWT_KEY`/cache setup — the same real, no-session
// path a genuine unauthenticated visitor takes in production.
//
// Proves the REAL mechanism, not just that `onError` fires at all (already covered by the sibling
// file above): the response must be a genuine `302` to the configured login URL, never a raw JSON
// `401` body — the exact regression `redirectUnauthenticatedPageVisit` exists to prevent.
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

Deno.test({
  name:
    'zanix space dev: a class-level @Guard-thrown 401 on a real, matched SSR page redirects to ' +
    'the configured login URL (globalErrorHandler + redirectUnauthenticatedPageVisit), instead of ' +
    'falling through to a raw JSON 401 body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const originalCwd = Deno.cwd()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify(
          {
            zanix: { project: 'space' },
            // Needed only because `guardAgainstUnlockedDependencies` (`spaceDevAction`'s own
            // startup guard) spawns a nested `deno install` against THIS fixture's own config with
            // no `--min-dep-age` flag of its own — it inherits Deno's default 24h policy instead of
            // this repo's own `--min-dep-age=0` convention (`deno.jsonc`'s own root
            // `minimumDependencyAge: 0`, which governs `cli`'s OWN resolution, never a fixture's).
            // Confirmed real, currently live: a `@zanix/space` release under 24h old makes that
            // nested install fail outright for every fixture in this folder, this one included,
            // with no relation to what this test itself is checking.
            minimumDependencyAge: 0,
            imports: {
              ...SPACE_CLIENT_IMPORTS,
              // `redirectUnauthenticatedPageVisit` only exists from `@zanix/auth@1.3.0` onward —
              // newer than `cli`'s own pinned `^1.2.1` range (`deno.jsonc`) — so `space.app.ts`'s
              // own top-level `import { redirectUnauthenticatedPageVisit } from '@zanix/auth'`
              // needs this explicit, newer entry to resolve against a version that exports it.
              '@zanix/auth': 'jsr:@zanix/auth@^1.3.1',
              // `@zanix/server`/`@zanix/space`/`@zanix/app` are always resolved against the SERVED
              // PROJECT's own config, never `cli`'s (`PROJECT_ANCHORED_ONLY_PACKAGES`,
              // `specifier-reconstruction.ts`) — this fixture's own `page.tsx` bare-importing
              // `Guard` from `@zanix/server` needs its own explicit entry here, unlike every OTHER
              // fixture in this folder, none of which import `@zanix/server` directly from a route
              // file.
              '@zanix/server': 'jsr:@zanix/server@^4.2.1',
            },
          },
          null,
          2,
        ),
      )
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import '@zanix/space/react'
import {
  createNotFoundHandler,
  defineBootstrapSpaceAppConfig,
  defineSpaceApp,
  globalErrorHandler,
} from '@zanix/space'
import { redirectUnauthenticatedPageVisit } from '@zanix/auth'

defineBootstrapSpaceAppConfig({
  server: {
    ssr: {
      onError: globalErrorHandler(
        redirectUnauthenticatedPageVisit({ loginUrl: () => '/login' }),
        createNotFoundHandler(),
      ),
      attachRequestToErrors: true,
    },
  },
})

export default defineSpaceApp({
  name: 'dev-live-guard-redirect-app',
  routesDir: './src/space/routes',
})
`,
      )
      // A real, class-level `@Guard` page under `routesDir`, its path inferred from its file
      // location (`guarded/page.tsx` -> `/guarded`), the same convention
      // `command-live-boot-pathless-page.test.ts` already establishes. The guard itself composes
      // `@zanix/auth`'s own `deriveSessionToken` directly — the same real, README-documented
      // building block `pageSessionGuard` itself is built on (`docs/configuration.md`'s
      // `requireSession` example) — rather than `pageSessionGuard` itself, since that convenience
      // wrapper also requires a `'cache'` core-provider slot registered somewhere in the app, a
      // separate concern this fixture has no reason to wire up. `deriveSessionToken` throws the
      // exact same real `HttpError('UNAUTHORIZED')` for a request with no session cookie either
      // way, with `options.cache` genuinely optional on this call.
      const routesDir = join(root, 'src', 'space', 'routes', 'guarded')
      await Deno.mkdir(routesDir, { recursive: true })
      await Deno.writeTextFile(
        join(routesDir, 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'
import { Guard, type MiddlewareGuard, type ScopedContext } from '@zanix/server'
import { deriveSessionToken } from '@zanix/auth'

function GuardedView() {
  return <h1>guarded-page-marker</h1>
}

const requireSession: MiddlewareGuard = async (ctx) => {
  await deriveSessionToken(ctx as unknown as ScopedContext)
  return {}
}

@Page()
@Guard(requireSession)
export default class GuardedPage extends SpacePageController {
  public override component = GuardedView
}
`,
      )
      Deno.chdir(root)
      const port = 48776
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      // No session cookie at all -> deriveSessionToken throws HttpError('UNAUTHORIZED') before the
      // page's own loader/component ever runs. `redirect: 'manual'` so the real 302 (and its
      // `location` header) is observed directly, instead of `fetch` silently following it.
      const response = await fetch(`http://localhost:${port}/guarded`, { redirect: 'manual' })
      const body = await response.text()
      assertEquals(
        response.status,
        302,
        `expected a 302 redirect, got ${response.status} (a raw JSON 401 body means the guard's ` +
          `throw never reached redirectUnauthenticatedPageVisit). Body: ${body}`,
      )
      assertEquals(response.headers.get('location'), '/login')
    } finally {
      Deno.chdir(originalCwd)
      await removeDirWithRetry(root)
    }
  },
})
