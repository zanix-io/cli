import { getTemporaryFolder } from '@zanix/helpers'
import { Commander } from 'cli'
import { join } from '@std/path'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import { SPACE_CLIENT_IMPORTS } from './space-client-imports.ts'

// Own file — `@zanix/space`'s `getGlobalCssPaths()` accumulates across every `defineSpaceApp()`
// call in the SAME process (`addGlobalCssPaths`, appending, never resetting), and Deno gives each
// test FILE its own module registry/globals. Sharing a file with `command.test.ts`'s own
// `globalCss: ['./app.css']` scaffold would leak that stale path into this file's own
// no-`globalCss` app, breaking the very "empty app" state this test needs to reproduce.

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

Deno.test(
  'zanix space build: --obfuscate on a valid-but-empty app (no comets/globalCss/pwa) never ' +
    'crashes — buildSpaceClient never even creates outDir/assets in that case',
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
  name: 'empty-app',
  routesDir: './routes',
})
`,
      )

      Deno.chdir(root)
      const cwd = new Commander()
      registerSpaceBuildCommand(cwd)
      const command = cwd.getCommands()[0] as unknown as ActionCommand

      await command.settings.actionHandler({ obfuscate: true })
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)
