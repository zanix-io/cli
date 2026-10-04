import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import { SPACE_CLIENT_IMPORTS } from './space-client-imports.ts'
import { disableNativeFreshnessCheckForTests } from '../shared/disable-native-freshness-check.ts'

// See disableNativeFreshnessCheckForTests's own doc for why this is needed here.
disableNativeFreshnessCheckForTests()

// Its own test file, like `command-css-sources.test.ts`: a real build per file keeps Rolldown/Vite's
// native binding state from being shared across files.
type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceBuildCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

Deno.test(
  'zanix space build: a Comet that lives in a local package outside the app root is built and ' +
    'registered under its real file, once',
  async () => {
    // The package sits NEXT TO the app, with a deno config of its own, as a monorepo's shared
    // package does: the CLI rewrites its modules into temporary copies to resolve their specifiers.
    const parent = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const root = join(parent, 'app')
    const pkg = join(parent, 'pkg')
    const originalCwd = Deno.cwd()
    try {
      await Deno.mkdir(join(root, 'routes'), { recursive: true })
      await Deno.mkdir(join(pkg, 'src'), { recursive: true })

      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify(
          { zanix: { project: 'space' }, minimumDependencyAge: 0, imports: SPACE_CLIENT_IMPORTS },
          null,
          2,
        ),
      )
      await Deno.writeTextFile(
        join(pkg, 'deno.json'),
        JSON.stringify({ minimumDependencyAge: 0, imports: SPACE_CLIENT_IMPORTS }, null, 2),
      )
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({ name: 'test-app-local-package-comets', routesDir: './routes' })
`,
      )
      // The Comet registers itself with `import.meta.url`, the way every ready-made Comet does.
      await Deno.writeTextFile(
        join(pkg, 'src', 'toast.comet.ts'),
        `'use comet'
import { defineComet } from '@zanix/space/comet'

function Toast() {
  return 'package-toast-marker'
}

export default defineComet(Toast, import.meta.url)
`,
      )
      await Deno.writeTextFile(
        join(pkg, 'src', 'feedback.ts'),
        `import Toast from './toast.comet.ts'

export const Feedback = Toast
`,
      )
      await Deno.writeTextFile(
        join(root, 'routes', 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'
import { Feedback } from '../../pkg/src/feedback.ts'

function HomeView() {
  return <Feedback />
}

@Page()
export default class HomePage extends SpacePageController {
  component = HomeView
}
`,
      )

      Deno.chdir(root)
      await registerCommand().settings.actionHandler({})

      const outDir = join(root, '.dist', 'client')
      const manifest: Record<string, string> = JSON.parse(
        await Deno.readTextFile(join(outDir, 'comets-manifest.json')),
      )
      // Keyed by the package's real file (never a `.zanix-import-*` copy), and only once. Space's own
      // ready-made Comets may sit in the manifest too.
      const entries = Object.entries(manifest).filter(([source]) => source.includes('toast.comet'))
      assertEquals(entries.length, 1, JSON.stringify(manifest))
      const [source, asset] = entries[0]
      assert(source.endsWith(join('pkg', 'src', 'toast.comet.ts')), source)
      assert(!source.includes('.zanix-import-'), source)
      // Its chunk exists and carries the Comet.
      const code = await Deno.readTextFile(join(outDir, asset.replace(/^\//, '')))
      assert(code.includes('package-toast-marker'), code)
      // The temporary copies are gone.
      for await (const entry of Deno.readDir(join(pkg, 'src'))) {
        assert(!entry.name.startsWith('.zanix-import-'), entry.name)
      }
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(parent, { recursive: true })
    }
  },
)
