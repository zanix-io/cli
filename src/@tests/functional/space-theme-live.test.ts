import { assert, assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { Commander } from 'cli'
import {
  copyThemeAssets,
  getSpaceUiThemeTemplate,
  getThemedGlobalCssPaths,
  LOCAL_SPACE_DEFAULTS_CSS,
  LOCAL_SPACE_DEFAULTS_CSS_TARGET,
  THEME_TEMPLATE_FILES,
} from 'commands/new/lib/tree/projects/space-theme.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import newSpaceAction from 'commands/new/actions/space.ts'

/**
 * `--theme default`'s own real, unmocked network path — `getSpaceUiThemeTemplate`/
 * `copyThemeAssets` fetch `@zanix/space-ui`'s scaffold templates for real, from
 * `https://jsr.io/@zanix/space-ui/<version>/src/templates/...`, the same real published package
 * `--icons`' own `functional/space-icons-live.test.ts` already fetches from. A real `fetch()`
 * disqualifies a test from `unit/` regardless of how contained it looks — this is why these live
 * here instead of alongside `space-theme.test.ts`'s other, purely local-I/O cases.
 *
 * Also the real home for the "`'default'` theme + `--icons` apply independently" assertion —
 * `space-icons-independence.test.ts`'s own former `.ignore`d placeholder: both features call a
 * real `fetch()`, so proving they land independently needs this tier too, not `unit/`.
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

const SPACE_UI_TEMPLATES_DIR = join(
  dirname(fromFileUrl(import.meta.url)),
  '../../../../space-ui/src/templates',
)

Deno.test(
  'getSpaceUiThemeTemplate: fetches theme/tokens.css for real from jsr.io, matching the local ' +
    '@zanix/space-ui checkout byte-for-byte',
  async () => {
    const fetched = await getSpaceUiThemeTemplate('theme/tokens.css')
    const local = await Deno.readTextFile(join(SPACE_UI_TEMPLATES_DIR, 'theme/tokens.css'))
    assertEquals(fetched, local)
  },
)

Deno.test(
  'copyThemeAssets: real end-to-end success — writes theme/* at the project ROOT (never nested ' +
    "under assets/, see space-theme.ts's own doc for why), real fetched content matching the " +
    "local @zanix/space-ui checkout, flattened to each entry's own target name, plus the embedded " +
    "space-defaults.css (not fetched — see space-theme.ts's own doc)",
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`

    try {
      await copyThemeAssets(root)

      await Promise.all(THEME_TEMPLATE_FILES.map(async ({ source, target }) => {
        const written = await Deno.readTextFile(join(root, 'theme', target))
        const local = await Deno.readTextFile(join(SPACE_UI_TEMPLATES_DIR, source))
        assertEquals(written, local, `${target} must match the real published ${source} content`)
      }))

      const writtenDefaults = await Deno.readTextFile(
        join(root, 'theme', LOCAL_SPACE_DEFAULTS_CSS_TARGET),
      )
      assertEquals(writtenDefaults, LOCAL_SPACE_DEFAULTS_CSS)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "ensureSpaceScaffoldSideEffects: 'default' theme + icons apply fully independently — a real " +
    'theme/ (project root) and a real assets/icons/ land on disk from the SAME call, and dropping ' +
    'either flag never affects the other',
  async () => {
    const bothRoot = `${temporaryFolder}/${crypto.randomUUID()}`
    const themedOnlyRoot = `${temporaryFolder}/${crypto.randomUUID()}`
    const iconsOnlyRoot = `${temporaryFolder}/${crypto.randomUUID()}`
    await Promise.all(
      [bothRoot, themedOnlyRoot, iconsOnlyRoot].map((root) =>
        Deno.mkdir(root, { recursive: true })
      ),
    )

    try {
      await ensureSpaceScaffoldSideEffects(bothRoot, 'base', true, 'react', 'default')
      await ensureSpaceScaffoldSideEffects(themedOnlyRoot, 'base', false, 'react', 'default')
      await ensureSpaceScaffoldSideEffects(iconsOnlyRoot, 'base', true)

      // Both flags together: both directories land.
      await Deno.stat(join(bothRoot, 'theme', 'tokens.css'))
      await Deno.stat(join(bothRoot, 'assets', 'icons', 'catalog.svg'))

      // 'default' theme alone: theme lands, icons never do.
      await Deno.stat(join(themedOnlyRoot, 'theme', 'tokens.css'))
      await assertRejectsNotFound(() => Deno.stat(join(themedOnlyRoot, 'assets', 'icons')))

      // icons alone (no theme): icons lands, theme never does.
      await Deno.stat(join(iconsOnlyRoot, 'assets', 'icons', 'catalog.svg'))
      await assertRejectsNotFound(() => Deno.stat(join(iconsOnlyRoot, 'theme')))
    } finally {
      await Promise.all(
        [bothRoot, themedOnlyRoot, iconsOnlyRoot].map((root) =>
          Deno.remove(root, { recursive: true })
        ),
      )
    }
  },
)

async function assertRejectsNotFound(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    throw new Error('expected Deno.errors.NotFound, but the path exists')
  } catch (error) {
    assert(error instanceof Deno.errors.NotFound, `expected NotFound, got: ${error}`)
  }
}

/**
 * Real `deno check` (`--min-dep-age 0`, same flag `verifyGeneratedProject` itself uses — a freshly
 * generated project always cites a package's own just-published latest version) against exactly
 * one file, run with `cwd: root` so `deno.json`'s own `imports` resolve — same convention
 * `space-icons-live.test.ts`'s own `denoCheck` helper already establishes.
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
  'newSpaceAction --theme default: space.app.ts declares the real globalCss list, a real ' +
    'theme/ (project root) lands on disk, deno.json declares NO @zanix/space-ui (pure CSS, ' +
    'no .ts import needs it), and a real `deno check` on space.app.ts still resolves',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const appPath = join(root, 'my-themed-space')

    try {
      await newSpaceAction.call(
        new Commander(),
        { template: 'base', theme: 'default' },
        appPath,
      )

      const appConfig = await Deno.readTextFile(join(appPath, 'space.app.ts'))
      for (const cssPath of getThemedGlobalCssPaths()) {
        assert(
          appConfig.includes(`'${cssPath}'`),
          `space.app.ts must list ${cssPath}:\n${appConfig}`,
        )
      }

      await Deno.stat(join(appPath, 'theme', 'tokens.css'))

      const denoJson = await Deno.readTextFile(join(appPath, 'deno.json'))
      assert(
        !denoJson.includes('"@zanix/space-ui"'),
        '--theme default alone must never declare @zanix/space-ui — no .ts file imports it',
      )

      const checkError = await denoCheck(appPath, 'space.app.ts')
      assertEquals(checkError, '', 'deno check must resolve space.app.ts for real')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
