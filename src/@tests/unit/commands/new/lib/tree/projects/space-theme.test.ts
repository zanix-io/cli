import { assert, assertEquals, assertRejects } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  getThemedGlobalCssPaths,
  LOCAL_SPACE_DEFAULTS_CSS,
  LOCAL_SPACE_DEFAULTS_CSS_TARGET,
  THEME_TEMPLATE_FILES,
  writeThemeFiles,
} from 'commands/new/lib/tree/projects/space-theme.ts'
import { getSpaceRecipes, getSpaceSrcTree } from 'commands/new/lib/tree/projects/space.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// ================================================================================================
// `--theme default` never touches routes/comets CONTENT — a visual theme has nothing to say about
// it, unlike `--template welcome` (see `space.ts`'s own doc: theme only ever affects
// `space.app.ts`'s `globalCss` field and, for `'astronaut'` specifically, the comet's own content).
// Proves that holds for real, for `base`'s own routes leaf, not just that nothing throws.
// ================================================================================================

Deno.test(
  "getSpaceSrcTree(root, 'base', 'default') produces the exact same file names as " +
    "(root, 'base') with no theme — 'default' changes space.app.ts/assets, never routes content",
  () => {
    const baseTree = getSpaceSrcTree('space-theme-alias-base', 'base')
    const themedTree = getSpaceSrcTree('space-theme-alias-themed', 'base', 'default')

    const namesOf = (node: typeof baseTree) => {
      const names: string[] = []
      const walk = (n: unknown) => {
        // deno-lint-ignore no-explicit-any
        const casted = n as any
        for (const file of casted?.templates?.base ?? []) names.push(file.NAME)
        for (const sub of Object.values(casted?.subfolders ?? {})) walk(sub)
      }
      walk(node)
      return names.sort()
    }

    assertEquals(namesOf(themedTree), namesOf(baseTree))
  },
)

Deno.test(
  'getSpaceRecipes(theme).base is the exact same array regardless of theme, not a copy — ' +
    'the routes leaf never varies by theme',
  () => {
    assertEquals(getSpaceRecipes('default').base, getSpaceRecipes().base)
    assertEquals(getSpaceRecipes('astronaut').base === getSpaceRecipes().base, true)
  },
)

// ================================================================================================
// writeThemeFiles — the disk-write half, deliberately independent of the network-fetch half
// (`getSpaceUiThemeTemplate`/`copyThemeAssets`, both real-network and covered in
// `functional/space-theme-live.test.ts` instead). Fully
// testable today: it only needs already-resolved content, never touches
// `ZANIX_DEPENDENCY_VERSIONS` or the network. Also writes the embedded `LOCAL_SPACE_DEFAULTS_CSS`
// unconditionally — no fetch involved for that one either.
// ================================================================================================

Deno.test(
  'writeThemeFiles: writes every THEME_TEMPLATE_FILES entry to theme/<target> (project root, ' +
    'never nested under assets/), flat, exact given content, plus the embedded ' +
    'LOCAL_SPACE_DEFAULTS_CSS',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    const stubContents = {
      'theme/tokens.css': ':root { --space-color-primary: #2f6fed; }',
      'shared/behavior.css': '.space-ui-overlay { background: black; }',
      'shared/card.css': '[data-space-ui="card"] { display: grid; }',
    }

    try {
      await writeThemeFiles(root, stubContents)

      await Promise.all(THEME_TEMPLATE_FILES.map(async ({ source, target }) => {
        const written = await Deno.readTextFile(join(root, 'theme', target))
        assertEquals(written, stubContents[source as keyof typeof stubContents])
      }))

      const localWritten = await Deno.readTextFile(
        join(root, 'theme', LOCAL_SPACE_DEFAULTS_CSS_TARGET),
      )
      assertEquals(localWritten, LOCAL_SPACE_DEFAULTS_CSS)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'writeThemeFiles: throws a clear error rather than writing partial content when a required ' +
    'file is missing from the given contents map',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`

    try {
      await assertRejects(
        () => writeThemeFiles(root, { 'theme/tokens.css': ':root {}' }),
        Error,
        'missing content for',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// ================================================================================================
// getThemedGlobalCssPaths — pure, no I/O — the exact `globalCss` list `getSpaceAppTemplate` writes
// into a generated `space.app.ts` for `--theme default`.
// ================================================================================================

Deno.test(
  'getThemedGlobalCssPaths: one ./theme/<target> entry per THEME_TEMPLATE_FILES entry, ' +
    'same declaration order, tokens.css first, LOCAL_SPACE_DEFAULTS_CSS_TARGET last',
  () => {
    assertEquals(getThemedGlobalCssPaths(), [
      './theme/tokens.css',
      './theme/behavior.css',
      './theme/card.css',
      './theme/space-defaults.css',
    ])
  },
)

// ================================================================================================
// Integrity — proves the CLI fetches/copies exactly the three real files @zanix/space-ui's
// currently PUBLISHED version ships across `src/templates/theme/tokens.css` + `src/templates/
// shared/{behavior,card}.css` (minus the icon catalog, which `space-icons.ts`'s own
// `ICON_TEMPLATE_FILES` integrity test already owns), without re-implementing that package's own
// content tests. `LOCAL_SPACE_DEFAULTS_CSS` gets its own, separate integrity test below — it is
// deliberately NOT JSR-fetched (see `space-theme.ts`'s own doc for why), so it's checked against
// the local `space-ui` checkout directly instead, with no network involved either way.
// ================================================================================================

Deno.test(
  'THEME_TEMPLATE_FILES sources match exactly what @zanix/space-ui ships at ' +
    'src/templates/{theme,shared}/ — no fourth theme file, none renamed',
  async () => {
    assertEquals(THEME_TEMPLATE_FILES, [
      { source: 'theme/tokens.css', target: 'tokens.css' },
      { source: 'shared/behavior.css', target: 'behavior.css' },
      { source: 'shared/card.css', target: 'card.css' },
    ])

    const spaceUiTemplatesDir = join(
      dirname(fromFileUrl(import.meta.url)),
      '../../../../../../../../../space-ui/src/templates',
    )

    const stats = await Promise.all(
      THEME_TEMPLATE_FILES.map(({ source }) => Deno.stat(join(spaceUiTemplatesDir, source))),
    )
    stats.forEach((stat, i) => {
      assert(
        stat.isFile,
        `${THEME_TEMPLATE_FILES[i].source} must exist as a real file in @zanix/space-ui`,
      )
    })
  },
)

Deno.test(
  "LOCAL_SPACE_DEFAULTS_CSS matches @zanix/space-ui's own local checkout at " +
    'src/templates/theme/space-defaults.css byte-for-byte — the embedded copy this module ships ' +
    "pending that file's own first real JSR publish (see space-theme.ts's own doc)",
  async () => {
    const spaceUiFile = join(
      dirname(fromFileUrl(import.meta.url)),
      '../../../../../../../../../space-ui/src/templates/theme/space-defaults.css',
    )
    const local = await Deno.readTextFile(spaceUiFile)
    assertEquals(LOCAL_SPACE_DEFAULTS_CSS, local)
  },
)
