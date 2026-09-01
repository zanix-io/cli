import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { Commander } from 'cli'
import newSpaceAction from 'commands/new/actions/space.ts'
import newSpacecraftAction from 'commands/new/actions/spacecraft.ts'

/**
 * `--template welcome`'s own real, unmocked `deno check` proof — same split
 * `space-icons-live.test.ts` already uses for `--icons`: `newSpaceAction`/`newSpacecraftAction`
 * called in-process (not a subprocess — same convention `space-icons-live.test.ts` itself follows),
 * against a real, isolated temp directory, then a real `deno check` (real JSR resolution) against
 * the generated `routes/page.tsx`, which imports `Link` from the real, published `@zanix/space-ui`.
 * Belongs here, not `unit/`, purely because of that last step — `deno check --min-dep-age 0`
 * resolves a real network call, which disqualifies it from `unit/` regardless of how contained it
 * looks. The rest of `--template welcome`'s own local
 * behavior (no network involved) is already covered in
 * `unit/commands/new/actions/space-welcome.test.ts`.
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

/** Same `denoCheck` helper/reasoning as `space-icons-live.test.ts`'s own — `--min-dep-age 0`
 * (a freshly generated project always cites a package's own just-published latest version), run
 * with `cwd: root` so the generated project's own `deno.json` resolves, not `cli`'s own. */
async function denoCheck(root: string, relativeFile: string): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['check', relativeFile, '--min-dep-age', '0'],
    cwd: root,
    stdout: 'null',
    stderr: 'piped',
  })
  const { success, stderr } = await command.output()
  return success ? '' : new TextDecoder().decode(stderr)
}

Deno.test(
  'newSpaceAction --template welcome: a real `deno check` on the generated routes/page.tsx ' +
    'resolves @zanix/space-ui for real, no manual `deno add` needed',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const appPath = join(root, 'my-welcome-space')

    try {
      await newSpaceAction.call(new Commander(), { template: 'welcome' }, appPath)

      const config = await Deno.readTextFile(join(appPath, 'deno.json'))
      assert(
        config.includes('"@zanix/space-ui"'),
        `deno.json must declare @zanix/space-ui once --template welcome runs:\n${config}`,
      )

      const checkError = await denoCheck(appPath, join('src', 'space', 'routes', 'page.tsx'))
      assertEquals(checkError, '', 'deno check must resolve @zanix/space-ui for real')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'newSpacecraftAction --template welcome --icons: welcome page AND icon catalog both land, ' +
    '--icons never gated by --template — real end-to-end, both real network paths exercised',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const projectPath = join(root, 'my-welcome-icons-spacecraft')

    try {
      await newSpacecraftAction.call(
        new Commander(),
        { template: 'welcome', icons: true },
        projectPath,
      )

      const page = await Deno.readTextFile(
        join(projectPath, 'src', 'space', 'routes', 'page.tsx'),
      )
      assert(page.includes('WelcomePage'), page)

      const wrapper = await Deno.readTextFile(
        join(projectPath, 'src', 'space', 'catalog-icon.ts'),
      )
      assert(wrapper.includes("from '@zanix/space-ui'"), wrapper)

      const checkError = await denoCheck(projectPath, join('src', 'space', 'routes', 'page.tsx'))
      assertEquals(checkError, '', 'deno check must resolve @zanix/space-ui for real')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
