import { assert, assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { Commander } from 'cli'
import {
  copyIconCatalog,
  getSpaceUiIconTemplate,
  ICON_TEMPLATE_FILES,
} from 'commands/new/lib/tree/projects/space-icons.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import newSpaceAction from 'commands/new/actions/space.ts'
import newSpacecraftAction from 'commands/new/actions/spacecraft.ts'

/**
 * `--icons`' own real, unmocked network path — `getSpaceUiIconTemplate`/`copyIconCatalog` fetch
 * `@zanix/space-ui`'s scaffold templates for real, from `https://jsr.io/@zanix/space-ui/<version>/
 * ...`, now that `ZANIX_DEPENDENCY_VERSIONS` has a real entry for it (verified directly against
 * `https://jsr.io/@zanix/space-ui/meta.json` — `latest: '0.1.0'`). A real `fetch()` disqualifies a
 * test from `unit/` regardless of how contained it looks — this is why these live here instead of
 * alongside `space-icons.test.ts`'s other, purely local-I/O cases.
 *
 * Content is verified against the local `space-ui` checkout's own `src/templates/shared/icons/`
 * files, same integrity guarantee `space-icons.test.ts`'s own `ICON_TEMPLATE_FILES` test already
 * gives for the file LIST — this additionally proves the fetched CONTENT genuinely round-trips.
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

const SPACE_UI_ICONS_DIR = join(
  dirname(fromFileUrl(import.meta.url)),
  '../../../../space-ui/src/templates/shared/icons',
)

Deno.test(
  'getSpaceUiIconTemplate: fetches catalog.svg for real from jsr.io, matching the local ' +
    '@zanix/space-ui checkout byte-for-byte',
  async () => {
    const fetched = await getSpaceUiIconTemplate('catalog.svg')
    const local = await Deno.readTextFile(join(SPACE_UI_ICONS_DIR, 'catalog.svg'))
    assertEquals(fetched, local)
  },
)

Deno.test(
  'copyIconCatalog: real end-to-end success — writes assets/icons/* and src/space/' +
    'catalog-icon.ts, real fetched content matching the local @zanix/space-ui checkout',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`

    try {
      await copyIconCatalog(root)

      await Promise.all(ICON_TEMPLATE_FILES.map(async (relativePath) => {
        const written = await Deno.readTextFile(join(root, 'assets/icons', relativePath))
        const local = await Deno.readTextFile(join(SPACE_UI_ICONS_DIR, relativePath))
        assertEquals(written, local, `${relativePath} must match the real published content`)
      }))

      const wrapper = await Deno.readTextFile(join(root, 'src/space/catalog-icon.ts'))
      assert(wrapper.includes("from '@zanix/space-ui'"))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'ensureSpaceScaffoldSideEffects: --icons now reaches real success for either renderer, not ' +
    'the graceful-degradation warning path — a real assets/icons/ and catalog-icon.ts (matching ' +
    'entrypoint) land on disk',
  async () => {
    for (const renderer of ['react', 'preact'] as const) {
      const root = `${temporaryFolder}/${crypto.randomUUID()}`
      // deno-lint-ignore no-await-in-loop
      await Deno.mkdir(root, { recursive: true })

      try {
        // deno-lint-ignore no-await-in-loop
        await ensureSpaceScaffoldSideEffects(root, 'base', true, renderer)

        // deno-lint-ignore no-await-in-loop
        await Deno.stat(join(root, 'assets', 'icons', 'catalog.svg'))
        // deno-lint-ignore no-await-in-loop
        const wrapper = await Deno.readTextFile(join(root, 'src', 'space', 'catalog-icon.ts'))
        const expectedEntry = renderer === 'preact' ? '@zanix/space-ui/preact' : '@zanix/space-ui'
        assert(wrapper.includes(`from '${expectedEntry}'`), wrapper)
      } finally {
        // deno-lint-ignore no-await-in-loop
        await Deno.remove(root, { recursive: true })
      }
    }
  },
)

/**
 * Real `deno check` (`--min-dep-age 0`, same flag `verifyGeneratedProject` itself uses — a
 * freshly generated project always cites a package's own just-published latest version) against
 * exactly one file, run with `cwd: root` so `deno.json`'s own `imports` resolve — same "sharp
 * edge" `verifyGeneratedProject`'s own doc calls out (omitting `cwd` picks up `cli`'s own
 * `deno.jsonc` instead of the generated project's, a false pass/fail against the wrong config
 * entirely).
 */
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
  'newSpaceAction --icons: the generated deno.json actually declares @zanix/space-ui (not just ' +
    '@zanix/space/@zanix/app/runtime), and a real `deno check` on the generated catalog-icon.ts ' +
    'resolves it — closing the gap where --icons wrote a real @zanix/space-ui import with no ' +
    'matching deno.json entry',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const appPath = join(root, 'my-space')

    try {
      await newSpaceAction.call(
        new Commander(),
        { template: 'base', icons: true },
        appPath,
      )

      const config = await Deno.readTextFile(join(appPath, 'deno.json'))
      assert(
        config.includes('"@zanix/space-ui"'),
        `deno.json must declare @zanix/space-ui once --icons succeeds:\n${config}`,
      )

      const checkError = await denoCheck(appPath, join('src', 'space', 'catalog-icon.ts'))
      assertEquals(checkError, '', 'deno check must resolve @zanix/space-ui for real')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'newSpacecraftAction --icons --renderer=preact: deno.json declares @zanix/space-ui, and a real ' +
    '`deno check` resolves the @zanix/space-ui/preact subpath from that SAME bare import-map ' +
    'entry — proving the single-entry subpath resolution empirically, not just asserting the ' +
    'generated import string',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const appPath = join(root, 'my-spacecraft')

    try {
      await newSpacecraftAction.call(
        new Commander(),
        { template: 'base', icons: true, renderer: 'preact' },
        appPath,
      )

      const config = await Deno.readTextFile(join(appPath, 'deno.json'))
      assert(
        config.includes('"@zanix/space-ui"'),
        `deno.json must declare @zanix/space-ui once --icons succeeds:\n${config}`,
      )
      assert(
        !config.includes('"@zanix/space-ui/preact"'),
        'a single bare @zanix/space-ui entry must cover the /preact subpath too — no separate ' +
          'subpath key needed, unlike @zanix/app/runtime',
      )

      const wrapper = await Deno.readTextFile(join(appPath, 'src', 'space', 'catalog-icon.ts'))
      assert(wrapper.includes("from '@zanix/space-ui/preact'"), wrapper)

      const checkError = await denoCheck(appPath, join('src', 'space', 'catalog-icon.ts'))
      assertEquals(
        checkError,
        '',
        'deno check must resolve @zanix/space-ui/preact from the bare @zanix/space-ui entry',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
