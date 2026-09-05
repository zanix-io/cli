// Registers the real React page renderer as a module-load side effect — `runDevValidation`'s own
// render-probe phase (`--validation=render`, below) reads it via `getPageRenderer()`, which throws
// unless one of `@zanix/space/react`/`@zanix/space/preact` was imported first (see that function's
// own doc in `@zanix/space`). Deno gives each test FILE its own module registry, so this has no
// effect outside this file.
import '@zanix/space/react'

import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { defineSpaceApp, setSitemapDeclaration, setValidationConfig } from '@zanix/space'
import { runDevValidation } from 'commands/space/dev/validation.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'

// `runDevValidation`'s own `@zanix/space`/`@zanix/space/vite` resolution
// (`importProjectDependency`, project-anchored — see that function's own doc) and its
// `await import(filePath)` for a discovered page (`importProjectModule`) both resolve against
// `withRoutesProject`'s own real `deno.json` below, unlike `zanix space dev`'s real Vite dev
// engine (see `command-live-boot.test.ts`'s own doc for why THAT path can't render a real page
// here). That makes this function directly, fully testable with a real scaffolded project and no
// Vite involved at all.

/**
 * Creates a real, isolated `routes` directory and, same as a real `space.app.ts` would,
 * eagerly declares it via `defineSpaceApp({ routesDir })` — `runDevValidation` itself reads this
 * back via `getRoutesDir()`, exactly as `zanix space dev` does for a real project, rather than
 * being told where to look directly. Every test declares its OWN absolute path this way, so
 * nothing leaks into another test sharing this file's module registry.
 *
 * Also writes a real `deno.json` declaring `@zanix/space`/`@zanix/space/vite` — `runDevValidation`
 * resolves both against `root`'s own nearest config now, never `@zanix/cli`'s (see
 * `importProjectDependency`'s own doc); without a real declaration here, resolution would only
 * "work" by accident, by walking up past `root` and landing on THIS repo's own `deno.jsonc`.
 */
async function withRoutesProject(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({
        imports: {
          '@zanix/space': ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
          '@zanix/space/vite': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/vite`,
        },
      }),
    )
    const routesDir = join(root, 'src', 'space', 'routes')
    await Deno.mkdir(routesDir, { recursive: true })
    defineSpaceApp({ name: 'dev-validation-test', routesDir })
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test('runDevValidation returns undefined when --no-validation is passed', async () => {
  await withRoutesProject(async (root) => {
    const report = await runDevValidation({ validation: false }, root)
    assertEquals(report, undefined)
  })
})

Deno.test(
  'runDevValidation returns undefined when the project itself disables validation ' +
    '(defineSpaceApp({ validation: false })) — a flag never opts a project back in',
  async () => {
    await withRoutesProject(async (root) => {
      setValidationConfig(false)
      try {
        const report = await runDevValidation({}, root)
        assertEquals(report, undefined)
      } finally {
        // Real, process-wide `@zanix/space` registry state (`setValidationConfig`'s own doc) —
        // reset so it never leaks into this file's other tests.
        setValidationConfig(undefined)
      }
    })
  },
)

Deno.test(
  'runDevValidation runs the static phase by default and reports the render phase as skipped',
  async () => {
    await withRoutesProject(async (root) => {
      await Deno.writeTextFile(
        join(root, 'src', 'space', 'routes', 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'

function HomeView() {
  return <h1>Home</h1>
}

@Page()
export default class HomePage extends SpacePageController {
  component = HomeView
}
`,
      )

      const report = await runDevValidation({}, root)

      assert(report, 'expected a real report, not undefined')
      assert(
        report.skipped.some((entry) => entry.includes('render phase did not run')),
        `expected the render phase to be reported as skipped, got: ${
          JSON.stringify(report.skipped)
        }`,
      )
      assertEquals(typeof report.blocking, 'boolean')
    })
  },
)

Deno.test(
  'runDevValidation --validation=render actually renders each discovered route through the real ' +
    'installed renderer — the one thing the static phase alone never does',
  async () => {
    await withRoutesProject(async (root) => {
      await Deno.writeTextFile(
        join(root, 'src', 'space', 'routes', 'page.tsx'),
        `import { Page, SpacePageController } from '@zanix/space'

function HomeView() {
  return <h1>Home</h1>
}

@Page()
export default class HomePage extends SpacePageController {
  component = HomeView
}
`,
      )

      const report = await runDevValidation({ validation: 'render' }, root)

      assert(report, 'expected a real report, not undefined')
      assert(
        report.skipped.every((entry) => !entry.includes('render phase did not run')),
        `expected the render phase to have actually run, got: ${JSON.stringify(report.skipped)}`,
      )
    })
  },
)

Deno.test(
  'runDevValidation reports the sitemap cross-check as skipped when the project declares no ' +
    "sitemap at all — the baseline this test file's own `sitemap: 'auto'` case below contrasts " +
    'with',
  async () => {
    await withRoutesProject(async (root) => {
      await Deno.writeTextFile(
        join(root, 'src', 'space', 'routes', 'page.tsx'),
        'export default null\n',
      )

      const report = await runDevValidation({}, root)

      assert(report, 'expected a real report, not undefined')
      assert(
        report.skipped.some((entry) => entry.includes('Sitemap cross-checks')),
        `expected the sitemap cross-check to be reported as skipped, got: ${
          JSON.stringify(report.skipped)
        }`,
      )
    })
  },
)

Deno.test(
  "runDevValidation resolves sitemap: 'auto' entries from the real route tree on disk — the " +
    'SEO004/SEO006 cross-checks actually run instead of being reported as skipped',
  async () => {
    await withRoutesProject(async (root) => {
      await Deno.writeTextFile(
        join(root, 'src', 'space', 'routes', 'page.tsx'),
        'export default null\n',
      )
      setSitemapDeclaration('auto')
      try {
        const report = await runDevValidation({}, root)

        assert(report, 'expected a real report, not undefined')
        assert(
          report.skipped.every((entry) => !entry.includes('Sitemap cross-checks')),
          `expected the sitemap cross-check to actually run, got: ${
            JSON.stringify(report.skipped)
          }`,
        )
      } finally {
        setSitemapDeclaration(undefined)
      }
    })
  },
)

Deno.test(
  "runDevValidation resolves routesDir from a project's own declaration even when it points " +
    'somewhere other than the conventional `src/space/routes` — the exact gap that let a ' +
    'non-default routesDir silently discover zero pages',
  async () => {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      // Same real declaration `withRoutesProject` writes above — this test builds its own `root`
      // by hand (a custom `routesDir`, outside that helper's fixed layout), so it needs the same
      // `deno.json` too.
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/space': ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
            '@zanix/space/vite': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/vite`,
          },
        }),
      )
      const routesDir = join(root, 'custom', 'pages')
      await Deno.mkdir(routesDir, { recursive: true })
      await Deno.writeTextFile(join(routesDir, 'page.tsx'), 'export default null\n')
      setSitemapDeclaration('auto')
      defineSpaceApp({ name: 'dev-validation-custom-routes', routesDir })
      try {
        const report = await runDevValidation({}, root)

        assert(report, 'expected a real report, not undefined')
        assert(
          report.skipped.every((entry) => !entry.includes('Sitemap cross-checks')),
          `expected the sitemap cross-check to actually run against the custom routesDir, got: ${
            JSON.stringify(report.skipped)
          }`,
        )
      } finally {
        setSitemapDeclaration(undefined)
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'runDevValidation --validation=render skips a discovered page with no default export, rather ' +
    'than crashing on it',
  async () => {
    await withRoutesProject(async (root) => {
      // Discovered the same way any other `page.tsx` is (`scanPageFiles` reports it purely from its
      // location under `routesDir` — see `discoverPages`'s own doc), but its module has no default
      // export, so `loadPage`'s own `if (!Target) return undefined` is the real, intended branch.
      await Deno.writeTextFile(
        join(root, 'src', 'space', 'routes', 'page.tsx'),
        `export const notAPage = true\n`,
      )

      const report = await runDevValidation({ validation: 'render' }, root)

      assert(report, 'expected a real report, not undefined')
    })
  },
)
