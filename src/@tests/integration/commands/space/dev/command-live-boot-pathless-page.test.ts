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
// Regression guard for a real, reported production bug: a project's own PATHLESS `@Page()` page —
// the route's path inferred from its file location under `routesDir`, the form every real
// `zanix new space` scaffold seeds and every framework doc recommends — never registers under a
// real `zanix space dev` session. Confirmed via a real A/B against a real consumer project
// (`@zanix/space@1.6.0` registers it correctly; `@zanix/space@1.6.1` does not, with zero thrown
// error anywhere — every OTHER route type, including the built-in `/assets/:path*` catch-all,
// registers fine).
//
// Neither this repo's own dev-live suite NOR `@zanix/space`'s own test suite catches this today:
// `command-live-boot.test.ts` (this same folder) deliberately scaffolds ZERO route files — see its
// own doc — so it never exercises a real page through the real dev engine at all.
// `@zanix/space`'s own `native-runtime-modules.test.ts` end-to-end test exercises a real page
// through a real dev engine, but its own doc explains why it can only use an EXPLICIT
// `@Page(path)` there: that repo IS `@zanix/space` itself, with no `'@zanix/space'` bare
// specifier of its own to import a fixture page through — the exact shape a PATHLESS page's own
// deferred registration (`pendingPages`/`resolvePendingPage`, `page-decorator.ts`) needs to prove
// anything real about. This file closes that gap from the one place that already has everything
// needed to write a real, external, `@zanix/space`-consuming fixture: this repo's own dev-live
// suite.
//
// Deliberately its own file, own port — same reasoning `command-live-boot.test.ts` already
// documents for staying separate from `command-live-conflict.test.ts`: each test file gets its own
// module registry, so a real `bootstrapServers()` call here never shares `@zanix/server`'s own
// process-wide boot-session/`webServerManager` state with another file's own call.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Same real `space.app.ts` shape `command-live-boot.test.ts` uses, plus one real, pathless
 * `@Page()`-decorated page under `routesDir` — the one thing that sibling fixture deliberately
 * omits (see its own doc). */
async function withPathlessPageScaffold(
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
  name: 'dev-live-pathless-page-app',
  routesDir: './src/space/routes',
})
`,
    )
    const routesDir = join(root, 'src', 'space', 'routes')
    await Deno.mkdir(routesDir, { recursive: true })
    await Deno.writeTextFile(
      join(routesDir, 'page.tsx'),
      `import { Page, SpacePageController } from '@zanix/space'

function HomeView() {
  return <h1>pathless-page-marker</h1>
}

@Page()
export default class HomePage extends SpacePageController {
  public override component = HomeView
}
`,
    )
    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test({
  name: "zanix space dev: a real PATHLESS @Page() — the route's path inferred from its file " +
    'location, the form every zanix new space scaffold seeds — actually registers and answers a ' +
    'real request, never a 404, through the real dev engine',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withPathlessPageScaffold(async () => {
      const port = 48793
      const command = registerCommand()
      await command.settings.actionHandler({ port, validation: false })

      const response = await fetch(`http://localhost:${port}/`)
      const html = await response.text()
      assertEquals(
        response.status,
        200,
        `expected the pathless page to register and answer 200, got ${response.status}. Body: ` +
          html,
      )
      assert(
        html.includes('pathless-page-marker'),
        `expected the real page's own rendered content, got: ${html}`,
      )
    })
  },
})
