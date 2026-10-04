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
  'zanix space build: a cssSources entry read with `import css from "./pkg.css" with { type: ' +
    '"text" }` is built with its real text, not an empty stylesheet',
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
      await Deno.writeTextFile(join(root, 'pkg.css'), '.pkg-text-marker { margin: 1px; }\n')
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'
import css from './pkg.css' with { type: 'text' }

export default defineSpaceApp({
  name: 'test-app-css-text-import',
  routesDir: './routes',
  cssSources: [{ name: 'pkg', css }],
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
      assertEquals(hrefs.length, 1)
      const text = await Deno.readTextFile(join(outDir, hrefs[0].replace(/^\//, '')))
      assert(text.includes('pkg-text-marker'), text)
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)
