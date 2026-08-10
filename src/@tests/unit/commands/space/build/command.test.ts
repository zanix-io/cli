import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'

type ActionCommand = { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }

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
  const root = await Deno.makeTempDir()
  const originalCwd = Deno.cwd()
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ zanix: { project: 'space' } }, null, 2),
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
      await command.actionHandler({})

      const outDir = join(root, 'dist', 'client')
      const cometManifest = JSON.parse(
        await Deno.readTextFile(join(outDir, 'comets-manifest.json')),
      )
      assertEquals(Object.keys(cometManifest).length, 1)

      const cssManifest = JSON.parse(await Deno.readTextFile(join(outDir, 'css-manifest.json')))
      assertEquals(cssManifest.length, 1)

      const jsAssets = []
      for await (const entry of Deno.readDir(join(outDir, 'assets'))) {
        if (entry.name.endsWith('.js')) jsAssets.push(entry.name)
      }
      assertEquals(jsAssets.length, 1)
      const code = await Deno.readTextFile(join(outDir, 'assets', jsAssets[0]))
      assert(code.includes('counter-marker'), code)

      // getPwaConfig() → buildSpaceClient({ pwa }) → resolvePwaPluginOptions → pwaPlugin — real
      // icons AND a real sw.js, from `space.app.ts`'s own PwaConfig alone, no separate plugin
      // config anywhere in this command.
      const icon192 = await Deno.stat(join(outDir, 'icons', 'icon-192.png')).then(() => true).catch(
        () => false,
      )
      assert(icon192, 'expected a real icon-192.png written to the client build output')
      const swExists = await Deno.stat(join(outDir, 'sw.js')).then(() => true).catch(() => false)
      assert(swExists, 'expected a real sw.js written to the client build output')
    })
  },
)

Deno.test(
  'zanix space build: --obfuscate obfuscates real output (comet chunk AND sw.js)',
  async () => {
    await withScaffoldedProject(async (root) => {
      const command = registerCommand()
      await command.actionHandler({ obfuscate: true })

      const outDir = join(root, 'dist', 'client')
      const jsAssets = []
      for await (const entry of Deno.readDir(join(outDir, 'assets'))) {
        if (entry.name.endsWith('.js')) jsAssets.push(entry.name)
      }
      assertEquals(jsAssets.length, 1)
      const code = await Deno.readTextFile(join(outDir, 'assets', jsAssets[0]))
      // Real evidence of obfuscation — the same shape of check `build.test.ts`'s own
      // `compileAndObfuscate` obfuscation test already uses: the original, readable function
      // structure is gone. Not asserting the marker STRING is absent —
      // `stringArrayThreshold: 0.75` is probabilistic, not absolute, so a short literal
      // surviving untouched is expected behavior, not a sign obfuscation didn't run (confirmed
      // empirically: it still doesn't).
      assert(!code.includes("function Counter() { return 'counter-marker' }"), code)
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
    await command.actionHandler({ minify: false })

    const outDir = join(root, 'dist', 'client', 'assets')
    const jsAssets = []
    for await (const entry of Deno.readDir(outDir)) {
      if (entry.name.endsWith('.js')) jsAssets.push(entry.name)
    }
    const code = await Deno.readTextFile(join(outDir, jsAssets[0]))
    assert(code.includes('\n'), code)
    assert(code.includes('function Counter'), code)
  })
})

Deno.test('zanix space build: --out-dir overrides the default dist/client location', async () => {
  await withScaffoldedProject(async (root) => {
    const command = registerCommand()
    await command.actionHandler({ outDir: 'build-output' })

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
