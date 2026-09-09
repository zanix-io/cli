import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import { getActiveRenderer } from '@zanix/space'
import { SPACE_CLIENT_IMPORTS } from './space-client-imports.ts'
import { disableNativeFreshnessCheckForTests } from '../shared/disable-native-freshness-check.ts'

// See disableNativeFreshnessCheckForTests's own doc for why this is needed here.
disableNativeFreshnessCheckForTests()

// Deliberately its OWN test file, not folded into `command.test.ts` — Deno gives each test FILE
// its own module registry/worker, so a real, back-to-back `preact()` build here never shares
// Rolldown/Vite's own native binding state with `command.test.ts`'s own sequence of `react()`
// builds (confirmed empirically: mixing renderers across sequential real builds in ONE process hit
// a real Rolldown binding error — never a scenario a real `zanix space build` invocation, always
// a single process/single build, would ever hit itself; a test-isolation artifact, not a
// production bug).
type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceBuildCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

Deno.test(
  "zanix space build: a project declaring renderer: 'preact' in space.app.ts builds cleanly " +
    "through spacePlugin({ renderer: 'preact' }) — real end-to-end proof that importSpaceApp()'s " +
    "eager setActiveRenderer (defineSpaceApp's own doc) reaches buildSpaceClient's own " +
    'getActiveRenderer() default, with zero renderer-specific code in this command itself',
  async () => {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const originalCwd = Deno.cwd()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify(
          { zanix: { project: 'space' }, imports: SPACE_CLIENT_IMPORTS },
          null,
          2,
        ),
      )
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'test-app-preact',
  routesDir: './routes',
  renderer: 'preact',
})
`,
      )
      await Deno.mkdir(join(root, 'comets'), { recursive: true })
      await Deno.writeTextFile(
        join(root, 'comets', 'counter.tsx'),
        `'use comet'\nexport default function Counter() { return 'counter-marker' }\n`,
      )

      Deno.chdir(root)
      const command = registerCommand()
      await command.settings.actionHandler({})

      assertEquals(getActiveRenderer(), 'preact')

      const outDir = join(root, '.dist', 'client')
      const cometManifest = JSON.parse(
        await Deno.readTextFile(join(outDir, 'comets-manifest.json')),
      )
      assertEquals(Object.keys(cometManifest).length, 1)
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "zanix space build: renderer: 'preact' also shares ONE ImportBatchContext across " +
    'buildSpaceClient — the shared-import dedup fix (action.ts) is renderer-agnostic, not ' +
    "react-specific (see command.test.ts's own identically-shaped react test)",
  async () => {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const originalCwd = Deno.cwd()
    try {
      const counterPath = join(root, 'shared-import-counter.txt')
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify(
          { zanix: { project: 'space' }, imports: SPACE_CLIENT_IMPORTS },
          null,
          2,
        ),
      )
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'test-preact-shared-import-app',
  routesDir: './src/space/routes',
  renderer: 'preact',
})
`,
      )
      const routes = join(root, 'src', 'space', 'routes')
      await Deno.mkdir(join(routes, 'about'), { recursive: true })
      // Same fixture shape as `command.test.ts`'s own react version of this test — reached ONLY
      // via a relative import from each page below, never a top-level entry `discoverPages` itself
      // calls `importModule` on.
      await Deno.writeTextFile(
        join(routes, 'shared-marker.ts'),
        `const path = ${JSON.stringify(counterPath)}
const existing = await Deno.readTextFile(path).catch(() => '')
await Deno.writeTextFile(path, existing + 'x')
export const marker = true
`,
      )
      await Deno.writeTextFile(
        join(routes, 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'
import './shared-marker.ts'

function HomeView() {
  return 'Home'
}

@Page()
export default class HomePage extends SpacePageController {
  static override head = { title: 'Home' }
  component = HomeView
}
`,
      )
      await Deno.writeTextFile(
        join(routes, 'about', 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'
import '../shared-marker.ts'

function AboutView() {
  return 'About'
}

@Page()
export default class AboutPage extends SpacePageController {
  static override head = { title: 'About' }
  component = AboutView
}
`,
      )

      Deno.chdir(root)
      const command = registerCommand()
      await command.settings.actionHandler({})

      assertEquals(getActiveRenderer(), 'preact')

      // Exactly one mark despite two pages reaching the shared file — same proof
      // `command.test.ts`'s own react test already establishes, confirming the dedup fix isn't
      // gated on which renderer the project declares (`discoverPages`'s own `importModule` call
      // takes no `renderer` argument at all — see `build-client.ts`'s own source).
      const marks = await Deno.readTextFile(counterPath)
      assertEquals(marks, 'x')
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)
