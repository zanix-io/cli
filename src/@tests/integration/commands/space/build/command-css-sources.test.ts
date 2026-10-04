import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import { SPACE_CLIENT_IMPORTS } from './space-client-imports.ts'
import { disableNativeFreshnessCheckForTests } from '../shared/disable-native-freshness-check.ts'

// See disableNativeFreshnessCheckForTests's own doc for why this is needed here.
disableNativeFreshnessCheckForTests()

// Its own test file, like `command-renderer.test.ts`: a real build per file keeps Rolldown/Vite's
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
  'zanix space build: the declared cssSources are built into css-manifest.json ahead of the ' +
    "app's own globalCss, the order zanix space dev serves them in",
  async () => {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const originalCwd = Deno.cwd()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify(
          { zanix: { project: 'space' }, minimumDependencyAge: 0, imports: SPACE_CLIENT_IMPORTS },
          null,
          2,
        ),
      )
      // A package's default styles (as `iam` ships its screens') and the app's own sheet.
      await Deno.writeTextFile(join(root, 'app.css'), '.app-marker { color: green; }\n')
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'test-app-css-sources',
  routesDir: './routes',
  globalCss: ['./app.css'],
  cssSources: [
    { name: 'pkg-a', css: '.pkg-a-marker { margin: 1px; }\\n' },
    { name: 'pkg-b', css: '.pkg-b-marker { padding: 2px; }\\n' },
  ],
})
`,
      )

      Deno.chdir(root)
      await registerCommand().settings.actionHandler({})

      const outDir = join(root, '.dist', 'client')
      const manifest = JSON.parse(await Deno.readTextFile(join(outDir, 'css-manifest.json')))
      const hrefs: string[] = manifest.global.map((entry: string | { href: string }) =>
        typeof entry === 'string' ? entry : entry.href
      )
      const texts = await Promise.all(
        hrefs.map((href) => Deno.readTextFile(join(outDir, href.replace(/^\//, '')))),
      )

      // The sources, in declaration order, then the app's own sheet: what the dev server links.
      assertEquals(hrefs.length, 3)
      assert(texts[0].includes('pkg-a-marker'), texts[0])
      assert(texts[1].includes('pkg-b-marker'), texts[1])
      assert(texts[2].includes('app-marker'), texts[2])
      // The sources are files the project owns, as `zanix space dev` reads them.
      assert(
        (await Deno.readTextFile(join(root, '.space', 'css-sources', 'pkg-a.css')))
          .includes('pkg-a-marker'),
      )
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)
