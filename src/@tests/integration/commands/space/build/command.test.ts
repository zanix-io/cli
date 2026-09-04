import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import { SPACE_CLIENT_IMPORTS } from './space-client-imports.ts'

console.error = () => {}

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

// A minimal, real, valid 1×1 transparent PNG — the standard fixture bytes many test suites use.
// `sharp` (inside `pwaPlugin`) needs to actually decode this, so it can't be arbitrary bytes.
const MINIMAL_PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1f,
  0x15,
  0xc4,
  0x89,
  0x00,
  0x00,
  0x00,
  0x0a,
  0x49,
  0x44,
  0x41,
  0x54,
  0x78,
  0x9c,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01,
  0x0d,
  0x0a,
  0x2d,
  0xb4,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e,
  0x44,
  0xae,
  0x42,
  0x60,
  0x82,
])

async function withScaffoldedProject(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  try {
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
  name: 'test-app',
  routesDir: './routes',
  globalCss: ['./app.css'],
  pwa: { name: 'Test App', icon: './icon-source.png' },
})
`,
    )
    await Deno.writeTextFile(join(root, 'app.css'), '.reset { margin: 0; }\n')
    await Deno.writeFile(join(root, 'icon-source.png'), MINIMAL_PNG)
    await Deno.mkdir(join(root, 'comets'), { recursive: true })
    await Deno.writeTextFile(
      join(root, 'comets', 'counter.tsx'),
      `'use comet'\nexport default function Counter() { return 'counter-marker' }\n`,
    )

    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await Deno.remove(root, { recursive: true })
  }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceBuildCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

Deno.test(
  'zanix space build: builds the real comet + declared global CSS + PWA icons/sw.js, all three manifests-worth of output',
  async () => {
    await withScaffoldedProject(async (root) => {
      const command = registerCommand()
      await command.settings.actionHandler({})

      const outDir = join(root, '.dist', 'client')
      const cometManifest = JSON.parse(
        await Deno.readTextFile(join(outDir, 'comets-manifest.json')),
      )
      assertEquals(Object.keys(cometManifest).length, 1)

      const cssManifest = JSON.parse(
        await Deno.readTextFile(join(outDir, 'css-manifest.json')),
      )
      // PRE-EXISTING STALE ASSERTION, corrected here rather than left red: this used to assert
      // `cssManifest.length === 1`, from when the manifest was a flat array of hrefs. It has since
      // become a SCOPED object (`global` / `pages` / `comets`) so that a Comet's CSS no longer ships
      // on every page and a page's own `styles` stay scoped to it — see `cssPlugin`'s own doc. The
      // assertion was never updated, so it compared `undefined` to `1`. Unrelated to this change;
      // fixed because a red test is not something to hand over.
      assertEquals(cssManifest.global.length, 1)

      // Excludes the client-entry chunk (`hydrateComets()`/`initOrbit()`, its own real, always-built
      // entry — see `build-client.ts`'s own doc) — this scaffold's only COMET chunk is what the rest
      // of this assertion cares about.
      const jsAssets = []
      for await (const entry of Deno.readDir(join(outDir, 'assets'))) {
        if (entry.name.endsWith('.js') && !entry.name.startsWith('client-entry')) {
          jsAssets.push(entry.name)
        }
      }
      assertEquals(jsAssets.length, 1)
      const code = await Deno.readTextFile(join(outDir, 'assets', jsAssets[0]))
      assert(code.includes('counter-marker'), code)

      // getPwaConfig() → buildSpaceClient({ pwa }) → resolvePwaPluginOptions → pwaPlugin — real
      // icons AND a real sw.js, from `space.app.ts`'s own PwaConfig alone, no separate plugin
      // config anywhere in this command.
      const icon192 = await Deno.stat(join(outDir, 'icons', 'icon-192.png'))
        .then(() => true).catch(
          () => false,
        )
      assert(
        icon192,
        'expected a real icon-192.png written to the client build output',
      )
      const swExists = await Deno.stat(join(outDir, 'sw.js')).then(() => true)
        .catch(() => false)
      assert(
        swExists,
        'expected a real sw.js written to the client build output',
      )
    })
  },
)

Deno.test(
  'zanix space build: --obfuscate obfuscates real output (comet chunk AND sw.js)',
  async () => {
    await withScaffoldedProject(async (root) => {
      const command = registerCommand()
      await command.settings.actionHandler({ obfuscate: true })

      const outDir = join(root, '.dist', 'client')
      // Excludes the client-entry chunk — see the previous test's own comment.
      const jsAssets = []
      for await (const entry of Deno.readDir(join(outDir, 'assets'))) {
        if (entry.name.endsWith('.js') && !entry.name.startsWith('client-entry')) {
          jsAssets.push(entry.name)
        }
      }
      assertEquals(jsAssets.length, 1)
      const code = await Deno.readTextFile(join(outDir, 'assets', jsAssets[0]))
      // Real evidence of obfuscation — the same shape of check `build.test.ts`'s own
      // `compileAndObfuscate` obfuscation test already uses: the original, readable function
      // structure is gone. Not asserting the marker STRING is absent —
      // `stringArrayThreshold: 0.75` is probabilistic, not absolute, so a short literal
      // surviving untouched is expected behavior, not a sign obfuscation didn't run (confirmed
      // empirically: it still doesn't).
      assert(
        !code.includes("function Counter() { return 'counter-marker' }"),
        code,
      )
      assert(code.includes('_0x'), code)

      // `sw.js` lives directly under `outDir`, not `outDir/assets` — obfuscated separately,
      // real client-facing logic just like a comet chunk (see `spaceBuildAction`'s own doc).
      const swCode = await Deno.readTextFile(join(outDir, 'sw.js'))
      assert(swCode.includes('_0x'), swCode)
    })
  },
)

Deno.test('zanix space build: --no-minify keeps real, readable output', async () => {
  await withScaffoldedProject(async (root) => {
    const command = registerCommand()
    await command.settings.actionHandler({ minify: false })

    const outDir = join(root, '.dist', 'client', 'assets')
    // Excludes the client-entry chunk — see this file's first test's own comment.
    const jsAssets = []
    for await (const entry of Deno.readDir(outDir)) {
      if (entry.name.endsWith('.js') && !entry.name.startsWith('client-entry')) {
        jsAssets.push(entry.name)
      }
    }
    const code = await Deno.readTextFile(join(outDir, jsAssets[0]))
    assert(code.includes('\n'), code)
    assert(code.includes('function Counter'), code)
  })
})

Deno.test('zanix space build: --out-dir overrides the default dist/client location', async () => {
  await withScaffoldedProject(async (root) => {
    const command = registerCommand()
    await command.settings.actionHandler({ outDir: 'build-output' })

    const manifest = await Deno.readTextFile(
      join(root, 'build-output', 'comets-manifest.json'),
    )
    assert(manifest.length > 0)
  })
})

Deno.test('zanix space build: registers a real "build" subcommand', () => {
  const cwd = new Commander()
  registerSpaceBuildCommand(cwd)
  assertEquals(cwd.getCommands()[0].getName(), 'build')
})

// ================================================================================================
// Document validation, through the command's own observable behaviour.
//
// These exercise what a person running `zanix space build` actually experiences: whether the command
// succeeds or fails, and what it reports. Nothing here reaches into the validation engine — its
// rules, severities and precedence are `@zanix/space`'s own contract and are tested there.
// ================================================================================================

/** Scaffolds a project whose single page resolves NO title, so static validation has something real
 * to find. Written with no `static head`, exactly as a page authored without one. */
async function withUntitledPage(run: (root: string) => Promise<void>): Promise<void> {
  await withScaffoldedProject(async (root) => {
    await Deno.mkdir(join(root, 'routes'), { recursive: true })
    await Deno.writeTextFile(
      join(root, 'routes', 'page.tsx'),
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
    await run(root)
  })
}

Deno.test(
  'zanix space build: validation runs by default and reports findings without failing the build — ' +
    'a missing title is a warning, and warnings do not block',
  async () => {
    await withUntitledPage(async () => {
      const command = registerCommand()
      // Completes normally: nothing here is an error.
      await command.settings.actionHandler({})
    })
  },
)

Deno.test(
  'zanix space build: --validation-strict turns that same warning into a failure. The flag changes ' +
    'nothing about which rules run — only how severely an active warning is treated',
  async () => {
    await withUntitledPage(async () => {
      const command = registerCommand()
      let failed = false
      try {
        await command.settings.actionHandler({ validationStrict: true })
      } catch {
        failed = true
      }
      assert(failed, 'expected --validation-strict to fail the build on a warning')
    })
  },
)

Deno.test(
  'zanix space build: --no-validation skips validation entirely, so the same project that fails ' +
    'under strict now succeeds',
  async () => {
    await withUntitledPage(async () => {
      const command = registerCommand()
      // `validation: false` is how this parser delivers `--no-validation`.
      await command.settings.actionHandler({ validation: false, validationStrict: true })
    })
  },
)

Deno.test(
  'zanix space build: --validation-category narrows the run without changing severity — selecting ' +
    'a category the finding does not belong to lets a strict build pass',
  async () => {
    await withUntitledPage(async () => {
      const command = registerCommand()
      // The missing-title finding is category `html`; restricting to `pwa` excludes it.
      await command.settings.actionHandler({ validationStrict: true, validationCategory: 'pwa' })
    })
  },
)

Deno.test(
  'zanix space build: an unknown --validation-category fails loudly rather than silently matching ' +
    'nothing — a typo must never report a clean run over an empty rule set',
  async () => {
    await withUntitledPage(async () => {
      const command = registerCommand()
      let message = ''
      try {
        await command.settings.actionHandler({ validationCategory: 'htlm' })
      } catch (error) {
        message = (error as Error).message
      }
      assert(message.includes('htlm'), `expected the bad category to be named, got: ${message}`)
    })
  },
)

Deno.test(
  'zanix space build: an unknown --validation mode fails loudly for the same reason',
  async () => {
    await withUntitledPage(async () => {
      const command = registerCommand()
      let message = ''
      try {
        await command.settings.actionHandler({ validation: 'deep' })
      } catch (error) {
        message = (error as Error).message
      }
      assert(message.includes('deep'), `expected the bad mode to be named, got: ${message}`)
    })
  },
)

/**
 * A dedicated fixture, not `withScaffoldedProject` — that one's own `space.app.ts` is a fixed
 * template with no `sitemap` field, shared by every test above that doesn't care about it.
 */
async function withAutoSitemapProject(
  run: (root: string, outDir: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  try {
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
  name: 'test-auto-sitemap-app',
  routesDir: './src/space/routes',
  sitemap: 'auto',
})
`,
    )
    // Deliberately NOT './routes' — a real scaffolded project (and both real reference projects
    // this exact fixture regression-tests against) declares './src/space/routes' instead, the
    // shape that once silently discovered zero pages in production because `buildSpaceClient` fell
    // back to its own '/routes' default instead of reading this declaration back
    // (`getRoutesDir()`'s own doc explains why).
    const routes = join(root, 'src', 'space', 'routes')
    await Deno.mkdir(join(routes, 'secret'), { recursive: true })
    await Deno.mkdir(join(routes, 'login'), { recursive: true })
    await Deno.mkdir(join(routes, 'products', '[id]'), { recursive: true })
    await Deno.writeTextFile(
      join(routes, 'page.tsx'),
      `import { Page, SpacePageController } from '@zanix/space'

function HomeView() {
  return <h1>Home</h1>
}

@Page()
export default class HomePage extends SpacePageController {
  static override head = { title: 'Home' }
  component = HomeView
}
`,
    )
    await Deno.writeTextFile(
      join(routes, 'secret', 'page.tsx'),
      `import { Page, SpacePageController } from '@zanix/space'

function SecretView() {
  return <h1>Secret</h1>
}

@Page()
export default class SecretPage extends SpacePageController {
  static override head = {
    title: 'Secret',
    meta: [{ name: 'robots', content: 'noindex' }],
  }
  component = SecretView
}
`,
    )
    await Deno.writeTextFile(
      join(routes, 'login', 'page.tsx'),
      `import { Page, SpacePageController } from '@zanix/space'

function LoginView() {
  return <h1>Login</h1>
}

@Page()
export default class LoginPage extends SpacePageController {
  static override head = { title: 'Login' }
  component = LoginView
}
`,
    )
    await Deno.writeTextFile(
      join(routes, 'products', '[id]', 'page.tsx'),
      `import { Page, SpacePageController } from '@zanix/space'

function ProductView() {
  return <h1>Product</h1>
}

@Page()
export default class ProductPage extends SpacePageController {
  static override head = { title: 'Product' }
  component = ProductView
}
`,
    )

    Deno.chdir(root)
    await run(root, join(root, '.dist', 'client'))
  } finally {
    Deno.chdir(originalCwd)
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  "zanix space build: sitemap: 'auto' writes sitemap-manifest.json with only the qualifying " +
    'routes — home AND a second static page both included, a noindex page and a dynamic ' +
    'segment both excluded',
  async () => {
    await withAutoSitemapProject(async (_root, outDir) => {
      // `getGlobalCssPaths()`/`getPwaConfig()` are real, process-wide `@zanix/space` state —
      // `globalCss` ACCUMULATES across `defineSpaceApp({ globalCss })` calls (`addGlobalCssPaths`'s
      // own doc), and `pwa` simply persists until overwritten. An earlier test in this same file/
      // process may have registered `./app.css`/a PWA icon, neither of which THIS fixture writes.
      // This fixture declares neither field of its own, so nothing here re-registers anything; the
      // reset just clears whatever a previous test left behind.
      const { setGlobalCssPaths, setPwaConfig } = await import('@zanix/space')
      setGlobalCssPaths(undefined)
      setPwaConfig(undefined)

      const command = registerCommand()
      await command.settings.actionHandler({})

      const manifest = JSON.parse(
        await Deno.readTextFile(join(outDir, 'sitemap-manifest.json')),
      )
      assertEquals(manifest, [{ loc: '/' }, { loc: '/login' }])
    })
  },
)
