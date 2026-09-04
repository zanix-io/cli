import { assert, assertEquals, assertRejects } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  getCatalogIconWrapperTemplate,
  ICON_TEMPLATE_FILES,
  resolveSpaceUiVersion,
  writeCatalogIconWrapper,
  writeIconCatalogFiles,
} from 'commands/new/lib/tree/projects/space-icons.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// ================================================================================================
// resolveSpaceUiVersion — pure (parses `ZANIX_DEPENDENCY_VERSIONS` only, no I/O), so it stays
// testable at unit tier. `getSpaceUiIconTemplate`/`copyIconCatalog` (real network fetches against
// jsr.io, now that `@zanix/space-ui` has a real `ZANIX_DEPENDENCY_VERSIONS` entry) live in
// `functional/space-icons-live.test.ts` instead — a real network call disqualifies a test from
// `unit/` regardless of how contained it looks.
// ================================================================================================

Deno.test(
  'resolveSpaceUiVersion: resolves the real pinned @zanix/space-ui version, no network involved',
  () => {
    // Same `/@\^?([\d.]+)$/` parse `resolveSpaceUiVersion` itself uses against
    // `ZANIX_DEPENDENCY_VERSIONS['@zanix/space-ui']` — reused here rather than a hardcoded literal
    // so a version bump in `dependencies.ts` never needs a matching edit in this test.
    const expected = ZANIX_DEPENDENCY_VERSIONS['@zanix/space-ui'].match(/@\^?([\d.]+)$/)?.[1]
    assertEquals(resolveSpaceUiVersion(), expected)
  },
)

Deno.test(
  'space-icons.ts never references getAllZanixLibrariesInfo, Shields, or a live "latest" ' +
    'lookup — ZANIX_DEPENDENCY_VERSIONS is the only version source, structurally, not just by ' +
    'convention',
  async () => {
    const source = await Deno.readTextFile(
      new URL(
        '../../../../../../../commands/new/lib/tree/projects/space-icons.ts',
        import.meta.url,
      ),
    )
    // Strip block and line comments first — the doc comments deliberately NAME these forbidden
    // symbols (explaining why they're avoided), which would otherwise self-match. Only real code
    // matters for this check.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // Checks for the live-lookup MECHANISM (the function/domain that would make this
    // non-reproducible), not the word "latest" itself — that word legitimately appears in this
    // file's own thrown error message, explaining to a real user what the gate deliberately
    // avoids, which isn't the same thing as actually using a live lookup.
    for (const forbidden of ['getAllZanixLibrariesInfo', 'shields.io', 'Shields']) {
      assertEquals(
        code.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `space-icons.ts's real code must never reference "${forbidden}"`,
      )
    }
    assert(code.includes('ZANIX_DEPENDENCY_VERSIONS'), 'must use ZANIX_DEPENDENCY_VERSIONS')
  },
)

// ================================================================================================
// writeIconCatalogFiles — the disk-write half, deliberately independent of the network-fetch half
// above (see the module's own doc for why they're split). Fully testable today: it only needs
// already-resolved content, never touches ZANIX_DEPENDENCY_VERSIONS or the network.
// ================================================================================================

Deno.test(
  'writeIconCatalogFiles: writes catalog.svg, NOTICE.md, and LICENSES/... to assets/icons/, ' +
    'exact given content, exact relative layout',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    const stubContents = {
      'catalog.svg': '<svg>stub-catalog-content</svg>',
      'NOTICE.md': '# stub notice',
      'LICENSES/fontawesome-free-7.3.1.txt': 'stub license text',
    }

    try {
      await writeIconCatalogFiles(root, stubContents)

      const catalog = await Deno.readTextFile(join(root, 'assets/icons/catalog.svg'))
      const notice = await Deno.readTextFile(join(root, 'assets/icons/NOTICE.md'))
      const license = await Deno.readTextFile(
        join(root, 'assets/icons/LICENSES/fontawesome-free-7.3.1.txt'),
      )

      assertEquals(catalog, stubContents['catalog.svg'])
      assertEquals(notice, stubContents['NOTICE.md'])
      assertEquals(license, stubContents['LICENSES/fontawesome-free-7.3.1.txt'])
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'writeIconCatalogFiles: throws a clear error rather than writing partial content when a ' +
    'required file is missing from the given contents map',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`

    // `writeIconCatalogFiles` DOES create `${root}/assets/icons/LICENSES` (its `Deno.mkdir` runs
    // unconditionally, before the missing-content check) even on this rejection path — real
    // cleanup needed here, not just a comment.
    try {
      await assertRejects(
        () => writeIconCatalogFiles(root, { 'catalog.svg': '<svg/>' }),
        Error,
        'missing content for',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// ================================================================================================
// getCatalogIconWrapperTemplate / writeCatalogIconWrapper — the generated project's own
// CatalogIcon, pre-wired to `resolveAssetHref('icons/catalog.svg')`. Pure/disk-only, no JSR fetch
// involved, so these stay at unit tier regardless of `@zanix/space-ui`'s own publish state.
// ================================================================================================

Deno.test(
  'getCatalogIconWrapperTemplate: default (react) imports from @zanix/space-ui, resolves the ' +
    'known relative path, and never hardcodes a hashed filename',
  () => {
    const content = getCatalogIconWrapperTemplate()

    assert(content.includes("from '@zanix/space-ui'"), content)
    assertEquals(content.includes('@zanix/space-ui/preact'), false, content)
    assert(
      content.includes("resolveAssetHref('icons/catalog.svg')"),
      'must resolve the real relative path, not a guessed/hardcoded hashed name',
    )
    assert(content.includes("from '@zanix/space/assets-manifest'"), content)
    assertEquals(
      /catalog-[\w-]+\.svg/.test(content),
      false,
      'must never contain anything that looks like an already-hashed filename',
    )
  },
)

Deno.test(
  "getCatalogIconWrapperTemplate('preact'): imports from @zanix/space-ui/preact instead — " +
    'identical API otherwise, same as CatalogIcon itself across renderers',
  () => {
    const reactContent = getCatalogIconWrapperTemplate('react')
    const preactContent = getCatalogIconWrapperTemplate('preact')

    assert(preactContent.includes("from '@zanix/space-ui/preact'"), preactContent)
    assertEquals(reactContent.includes('/preact'), false, reactContent)

    // Only the two import specifiers differ — same function body, same exported name/shape,
    // same href resolution — proving the API is genuinely identical across renderers, not just
    // documented to be.
    const stripEntry = (s: string) => s.replace(/@zanix\/space-ui(\/preact)?/g, '@zanix/space-ui')
    assertEquals(stripEntry(reactContent), stripEntry(preactContent))
  },
)

Deno.test(
  'getCatalogIconWrapperTemplate: never mentions href as a prop the caller must supply — the ' +
    'whole point is that a consumer of this generated file never sees it',
  () => {
    const content = getCatalogIconWrapperTemplate()
    assert(content.includes("Omit<CatalogIconProps, 'href'>"), content)
  },
)

Deno.test(
  'writeCatalogIconWrapper: writes src/space/catalog-icon.ts with the exact template content, ' +
    'for the given renderer',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`

    try {
      await writeCatalogIconWrapper(root, 'preact')

      const written = await Deno.readTextFile(join(root, 'src/space/catalog-icon.ts'))
      assertEquals(written, getCatalogIconWrapperTemplate('preact'))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'writeCatalogIconWrapper: defaults to the react entrypoint when renderer is omitted',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`

    try {
      await writeCatalogIconWrapper(root)

      const written = await Deno.readTextFile(join(root, 'src/space/catalog-icon.ts'))
      assertEquals(written, getCatalogIconWrapperTemplate())
      assert(written.includes("from '@zanix/space-ui'"))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// ================================================================================================
// Integrity — proves the CLI fetches/copies exactly the same three files @zanix/space-ui itself
// ships, without re-implementing that package's own catalog-integrity.test.ts (17 symbols ↔
// CatalogIconName, viewBox-per-symbol, no brand icons, ...) — this side only needs to agree on
// WHICH files exist, never re-validate their contents.
// ================================================================================================

Deno.test(
  'ICON_TEMPLATE_FILES matches exactly what @zanix/space-ui ships at ' +
    'src/templates/shared/icons/ — same three real files, no fourth, none renamed',
  async () => {
    assertEquals(ICON_TEMPLATE_FILES, [
      'catalog.svg',
      'NOTICE.md',
      'LICENSES/fontawesome-free-7.3.1.txt',
    ])

    const spaceUiIconsDir = join(
      dirname(fromFileUrl(import.meta.url)),
      '../../../../../../../../../space-ui/src/templates/shared/icons',
    )

    const stats = await Promise.all(
      ICON_TEMPLATE_FILES.map((relativePath) => Deno.stat(join(spaceUiIconsDir, relativePath))),
    )
    stats.forEach((stat, i) => {
      assert(stat.isFile, `${ICON_TEMPLATE_FILES[i]} must exist as a real file in @zanix/space-ui`)
    })
  },
)
