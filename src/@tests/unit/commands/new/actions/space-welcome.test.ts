import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import newSpaceAction from 'commands/new/actions/space.ts'
import newSpacecraftAction from 'commands/new/actions/spacecraft.ts'

/**
 * `--template welcome`, real end-to-end proof — same shape as `space-renderer.test.ts`'s own use
 * of the real action: writes to a real, isolated temp directory rather than mocking the
 * tree/side-effect helpers. Kept in `unit/`, not `functional/`, because every case here runs with
 * `icons: false` — `ensureSpaceScaffoldSideEffects` never calls `copyIconCatalog` at all when
 * `icons` is falsy (see `space-icons.ts`'s own doc), so nothing in this file makes a real network
 * call; `--icons`/`--template welcome` together (which DOES touch the network, for the icon
 * catalog fetch) is covered separately. The real, unmocked `deno check` proof that the generated
 * `page.tsx`'s `@zanix/space-ui` import actually resolves lives in
 * `functional/space-welcome-live.test.ts` instead — same split `space-icons-live.test.ts` already
 * uses for `--icons`.
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: temporaryFolder })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'newSpaceAction --template welcome: writes the real welcome page.tsx and declares ' +
    '@zanix/space-ui, even with --icons off',
  async () => {
    await withTempDir(async (root) => {
      const appPath = join(root, 'my-welcome-space')
      await newSpaceAction.call(new Commander(), { template: 'welcome', icons: false }, appPath)

      const page = await Deno.readTextFile(join(appPath, 'src', 'space', 'routes', 'page.tsx'))
      assert(page.includes('WelcomePage'), page)
      assert(page.includes("from '@zanix/space-ui'"), page)

      const config = await Deno.readTextFile(join(appPath, 'deno.json'))
      assert(
        config.includes('"@zanix/space-ui"'),
        `deno.json must declare @zanix/space-ui for --template welcome, icons or not:\n${config}`,
      )

      assertEquals(
        await Deno.stat(join(appPath, 'assets', 'icons')).then(() => true).catch(() => false),
        false,
        '--template welcome must never write assets/icons on its own — that stays --icons-only',
      )
    })
  },
)

Deno.test(
  'newSpaceAction --template base (default): never declares @zanix/space-ui — only welcome does',
  async () => {
    await withTempDir(async (root) => {
      const appPath = join(root, 'my-base-space')
      await newSpaceAction.call(new Commander(), { template: 'base' }, appPath)

      const page = await Deno.readTextFile(join(appPath, 'src', 'space', 'routes', 'page.tsx'))
      assertFalse(page.includes('WelcomePage'), page)

      const config = await Deno.readTextFile(join(appPath, 'deno.json'))
      assertFalse(
        config.includes('"@zanix/space-ui"'),
        `a plain base scaffold must never import a package it never uses:\n${config}`,
      )
    })
  },
)

Deno.test(
  'newSpacecraftAction --template welcome: writes the real welcome page.tsx and declares ' +
    '@zanix/space-ui, even with --icons off',
  async () => {
    await withTempDir(async (root) => {
      const projectPath = join(root, 'my-welcome-spacecraft')
      await newSpacecraftAction.call(
        new Commander(),
        { template: 'welcome', icons: false },
        projectPath,
      )

      const page = await Deno.readTextFile(
        join(projectPath, 'src', 'space', 'routes', 'page.tsx'),
      )
      assert(page.includes('WelcomePage'), page)

      const config = await Deno.readTextFile(join(projectPath, 'deno.json'))
      assert(
        config.includes('"@zanix/space-ui"'),
        `deno.json must declare @zanix/space-ui for --template welcome, icons or not:\n${config}`,
      )
    })
  },
)
