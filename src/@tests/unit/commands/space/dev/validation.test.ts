// Registers the real React page renderer as a module-load side effect — `runDevValidation`'s own
// render-probe phase (`--validation=render`, below) reads it via `getPageRenderer()`, which throws
// unless one of `@zanix/space/react`/`@zanix/space/preact` was imported first (see that function's
// own doc in `@zanix/space`). Deno gives each test FILE its own module registry, so this has no
// effect outside this file.
import '@zanix/space/react'

import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { setValidationConfig } from '@zanix/space'
import { runDevValidation } from 'commands/space/dev/validation.ts'

// `runDevValidation`'s own dynamic imports (`await import('@zanix/space')`,
// `await import(filePath)` for a discovered page) are all plain, native Deno `import()` calls —
// resolved against THIS repo's own `deno.jsonc`, unlike `zanix space dev`'s real Vite dev engine
// (see `command-live-boot.test.ts`'s own doc for why THAT path can't render a real page here). That
// makes this function directly, fully testable with a real scaffolded project and no Vite involved
// at all.

async function withRoutesProject(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await Deno.mkdir(join(root, 'src', 'space', 'routes'), { recursive: true })
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
