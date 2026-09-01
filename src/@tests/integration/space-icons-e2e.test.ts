import { assert, assertEquals, assertExists } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import {
  ICON_TEMPLATE_FILES,
  writeCatalogIconWrapper,
  writeIconCatalogFiles,
} from 'commands/new/lib/tree/projects/space-icons.ts'
import { SPACE_CLIENT_IMPORTS } from './commands/space/build/space-client-imports.ts'

/**
 * The real, full flow this test proves — no mock, no stub, every step the actual mechanism:
 *
 * ```
 * (--icons' own scaffold output, written directly here — see the note below on why the
 *  JSR-fetch half is bypassed) → real assets/icons/catalog.svg + src/space/catalog-icon.ts
 *   → a real `defineSpaceApp({ assetsDir, optimize: { svg: { preserveIds } } })`
 *   → the REAL `zanix space build` command (`registerSpaceBuildCommand`)
 *   → the REAL `buildSpaceClient` → `assetsPlugin` → `optimizeSvgAsset`
 *   → a real hashed assets-manifest.json, catalog.svg's ids intact
 *   → `loadAssetsManifest` (the same call `--icons`' own generated mod.ts now makes
 *     unconditionally — see `getSpaceModTemplate`'s own doc)
 *   → the REAL generated `src/space/catalog-icon.ts`, dynamically imported as a real module
 *   → its `CatalogIcon({ name: 'search' })` resolves to the REAL hashed href, not a guess
 * ```
 *
 * `copyIconCatalog`'s own JSR-fetch half is deliberately bypassed here (`writeIconCatalogFiles`
 * is called directly, with REAL content read straight from `@zanix/space-ui`'s own
 * `src/templates/shared/icons/` on disk) — this build/asset-pipeline test doesn't need the real
 * network fetch to prove its own point (real `copyIconCatalog` success is proven independently,
 * in `functional/space-icons-live.test.ts`); staying hermetic here keeps this test fast and
 * independent of network availability. Everything downstream of "the files exist on disk" is
 * exercised for real, with no shortcut: this is
 * exactly what a project ends up with once the gate clears, not a simulation of it.
 */

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function realIconCatalogContents(): Promise<Record<string, string>> {
  const spaceUiIconsDir = join(
    dirname(fromFileUrl(import.meta.url)),
    '../../../../space-ui/src/templates/shared/icons',
  )
  const entries = await Promise.all(
    ICON_TEMPLATE_FILES.map(
      async (relativePath) =>
        [relativePath, await Deno.readTextFile(join(spaceUiIconsDir, relativePath))] as const,
    ),
  )
  return Object.fromEntries(entries)
}

/** Everything `--icons`' own scaffold writes today, plus a real `space.app.ts` declaring
 * `optimizeBlock` verbatim as its own `optimize` field — the one piece that stays the project
 * author's own, hand-authored decision, never injected by `new` (see the Styling Proposal's own
 * resolution). `optimizeBlock` is raw TS source text (e.g. `'svg: true,'` or
 * `'svg: { preserveIds: [\'icons/**\'] },'`), spliced in as-is — kept a plain string rather than a
 * typed object so each call site reads exactly like the real file a developer would write. */
async function scaffoldProject(root: string, optimizeBlock: string): Promise<void> {
  await writeIconCatalogFiles(root, await realIconCatalogContents())
  await writeCatalogIconWrapper(root) // default (react) renderer

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
  name: 'icons-e2e',
  routesDir: './routes',
  assetsDir: './assets',
  optimize: {
    ${optimizeBlock}
  },
})
`,
  )
}

/** Runs the REAL `zanix space build` command against `Deno.cwd()` (the caller must `Deno.chdir`
 * first) — no test-only shortcut, the same `registerSpaceBuildCommand` a real CLI invocation
 * goes through. */
async function runRealSpaceBuild(): Promise<void> {
  const command = new Commander()
  registerSpaceBuildCommand(command)
  const action = command.getCommands()[0] as unknown as {
    settings: { actionHandler: (options: Record<string, unknown>) => Promise<void> }
  }
  await action.settings.actionHandler({})
}

Deno.test(
  'end-to-end: new --icons’ own scaffold output + optimize.svg.preserveIds → real zanix space ' +
    'build → real hashed manifest, ids intact → generated CatalogIcon resolves the real final href',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    const originalCwd = Deno.cwd()
    const { setAssetsManifestState } = await import('@zanix/space/assets-manifest')

    try {
      await scaffoldProject(root, "svg: {\n      preserveIds: ['icons/**'],\n    },")

      Deno.chdir(root)
      await runRealSpaceBuild()

      const outDir = join(root, '.dist', 'client')
      const manifest: Record<string, string> = JSON.parse(
        await Deno.readTextFile(join(outDir, 'assets-manifest.json')),
      )
      const hashedHref = manifest['icons/catalog.svg']
      assertExists(hashedHref, JSON.stringify(manifest))
      assert(
        /\/assets\/icons\/catalog-[\w-]+\.svg$/.test(hashedHref),
        `expected a real hashed href, got: ${hashedHref}`,
      )

      const builtCatalog = await Deno.readTextFile(
        join(outDir, hashedHref.replace(/^\//, '')),
      )
      assert(
        builtCatalog.includes('id="search"'),
        'preserveIds must have kept the real symbol ids through the actual zanix space build, ' +
          'not just in a direct assetsPlugin() unit test',
      )

      // --- loadAssetsManifest, the SAME call --icons' own generated mod.ts now makes
      // unconditionally — proves the wrapper's resolveAssetHref call sees a REAL loaded
      // manifest, the same way a running app would after startup -----------------------------
      const { loadAssetsManifest } = await import('@zanix/space')
      await loadAssetsManifest(join(outDir, 'assets-manifest.json'))

      try {
        // --- the REAL generated wrapper file, imported as a real module -------------------
        const wrapperUrl = new URL(`file://${join(root, 'src/space/catalog-icon.ts')}`)
        const { CatalogIcon } = await import(wrapperUrl.href)

        const element = CatalogIcon({ name: 'search' })
        // `Icon/render.ts`'s own markup: h('svg', {...}, h('use', { href: `${href}#${name}` }))
        // — the real href lives on the single <use> child, not the outer <svg>'s own props.
        const useHref = element.props.children.props.href

        assertEquals(
          useHref,
          `${hashedHref}#search`,
          'CatalogIcon (via the generated wrapper) must resolve to the REAL hashed build URL, ' +
            'not the unhashed /assets/icons/catalog.svg passthrough — proving the full chain, ' +
            'not just that a manifest happens to exist',
        )
      } finally {
        setAssetsManifestState(undefined)
      }
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'end-to-end: a BARE optimize.svg: true (no preserveIds at all) already keeps the real ' +
    'catalog’s ids through the real zanix space build — the default is safe on its own',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    const originalCwd = Deno.cwd()

    try {
      await scaffoldProject(root, 'svg: true,')

      Deno.chdir(root)
      await runRealSpaceBuild()

      const outDir = join(root, '.dist', 'client')
      const manifest: Record<string, string> = JSON.parse(
        await Deno.readTextFile(join(outDir, 'assets-manifest.json')),
      )
      const hashedHref = manifest['icons/catalog.svg']
      assertExists(hashedHref, JSON.stringify(manifest))

      const builtCatalog = await Deno.readTextFile(
        join(outDir, hashedHref.replace(/^\//, '')),
      )
      assert(
        builtCatalog.includes('id="search"'),
        'a bare `svg: true`, with NO preserveIds declared, must already keep the real catalog ' +
          'ids through the actual zanix space build — the symbol-id protection is automatic, ' +
          'not opt-in',
      )
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)
