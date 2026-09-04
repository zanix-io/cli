import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import newSpaceAction from 'commands/new/actions/space.ts'
import newSpacecraftAction from 'commands/new/actions/spacecraft.ts'

/**
 * `--template population`/`population-lang`, real end-to-end proof — same shape as
 * `space-welcome.test.ts`'s own use of the real action, for the same reason: every case here runs
 * with `icons: false`, so nothing here makes a real network call.
 *
 * Real, confirmed regression this file locks in: `page.tsx` (`space-population.ts`) imports
 * `IntlProvider`/`Link`/`useIntl` from `@zanix/space-ui` unconditionally, exactly like `welcome`'s
 * own page does — `newSpaceAction`/`newSpacecraftAction`'s `ensureSpaceUiDependency` gate must
 * include `'population'`/`'population-lang'`, not just `'welcome'`, or a generated project's own
 * `deno.json` never declares a package its own generated code imports.
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

for (const template of ['population', 'population-lang']) {
  Deno.test(
    `newSpaceAction --template ${template}: writes the i18n/population page.tsx, declares ` +
      '@zanix/space-ui, and seeds messages/middleware.ts, even with --icons off',
    async () => {
      await withTempDir(async (root) => {
        const appPath = join(root, `my-${template}-space`)
        await newSpaceAction.call(new Commander(), { template, icons: false }, appPath)

        const page = await Deno.readTextFile(
          join(
            appPath,
            'src',
            'space',
            'routes',
            template === 'population-lang' ? '[lang]' : '.',
            'page.tsx',
          ),
        )
        assert(page.includes("from '@zanix/space-ui'"), page)

        const config = await Deno.readTextFile(join(appPath, 'deno.json'))
        assert(
          config.includes('"@zanix/space-ui"'),
          `deno.json must declare @zanix/space-ui for --template ${template}, icons or not:\n${config}`,
        )

        const middleware = await Deno.readTextFile(
          join(appPath, 'src', 'space', 'middleware.ts'),
        )
        assert(middleware.includes('populationGuard()'), middleware)

        const baseCatalog = await Deno.readTextFile(
          join(
            appPath,
            'messages',
            template === 'population-lang' ? 'en' : 'default',
            'index.json',
          ),
        )
        assert(JSON.parse(baseCatalog)['population/greeting'], baseCatalog)
      })
    },
  )

  Deno.test(
    `newSpacecraftAction --template ${template}: writes the i18n/population page.tsx and ` +
      'declares @zanix/space-ui, even with --icons off',
    async () => {
      await withTempDir(async (root) => {
        const projectPath = join(root, `my-${template}-spacecraft`)
        await newSpacecraftAction.call(new Commander(), { template, icons: false }, projectPath)

        const page = await Deno.readTextFile(
          join(
            projectPath,
            'src',
            'space',
            'routes',
            template === 'population-lang' ? '[lang]' : '.',
            'page.tsx',
          ),
        )
        assert(page.includes("from '@zanix/space-ui'"), page)

        const config = await Deno.readTextFile(join(projectPath, 'deno.json'))
        assert(
          config.includes('"@zanix/space-ui"'),
          `deno.json must declare @zanix/space-ui for --template ${template}:\n${config}`,
        )
      })
    },
  )
}

Deno.test(
  'newSpaceAction --template population-lang: routes/page.tsx lands at [lang]/page.tsx, never ' +
    'at the plain routes/page.tsx --template population uses',
  async () => {
    await withTempDir(async (root) => {
      const appPath = join(root, 'my-lang-space')
      await newSpaceAction.call(
        new Commander(),
        { template: 'population-lang', icons: false },
        appPath,
      )

      assertFalse(
        await Deno.stat(join(appPath, 'src', 'space', 'routes', 'page.tsx')).then(() => true)
          .catch(() => false),
        'population-lang must not also write a plain routes/page.tsx',
      )
    })
  },
)
