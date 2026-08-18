import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import newSpaceAction from 'commands/new/actions/space.ts'

// Real end-to-end proof, one level above `renderer-wiring.test.ts`'s own tree-assembly coverage:
// runs the REAL `newSpaceAction` (what `zanix new space --renderer=preact` itself calls), writes
// to a real, isolated temp directory, and reads back the real files it wrote — deno.json AND
// space.app.ts, matching what a developer would actually see after running the command.
async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  try {
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'newSpaceAction: --renderer=preact writes a real preact-configured deno.json AND a real ' +
    "renderer: 'preact' field in space.app.ts",
  async () => {
    await withTempDir(async (root) => {
      const appPath = join(root, 'my-preact-app')
      await newSpaceAction.call(
        new Commander(),
        { template: 'base', renderer: 'preact' },
        appPath,
      )

      const config = JSON.parse(await Deno.readTextFile(join(appPath, 'deno.json')))
      assertEquals(config.compilerOptions.jsxImportSource, 'preact')
      assertEquals(config.imports.preact, 'npm:preact@^10.29.0')
      assertEquals(config.imports.react, undefined)

      const spaceApp = await Deno.readTextFile(join(appPath, 'space.app.ts'))
      assert(spaceApp.includes("renderer: 'preact',"), spaceApp)
    })
  },
)

Deno.test(
  'newSpaceAction: --renderer omitted writes the same real react-configured deno.json as before ' +
    '--renderer existed, no renderer field in space.app.ts',
  async () => {
    await withTempDir(async (root) => {
      const appPath = join(root, 'my-react-app')
      await newSpaceAction.call(new Commander(), { template: 'base' }, appPath)

      const config = JSON.parse(await Deno.readTextFile(join(appPath, 'deno.json')))
      assertEquals(config.compilerOptions.jsxImportSource, 'react')
      assertEquals(config.imports.react, 'npm:react@^19.2.0')
      assertEquals(config.imports.preact, undefined)

      const spaceApp = await Deno.readTextFile(join(appPath, 'space.app.ts'))
      assertFalse(spaceApp.includes('renderer:'), spaceApp)
    })
  },
)

Deno.test('newSpaceAction: an unsupported --renderer value throws a clear error', async () => {
  await withTempDir(async (root) => {
    const appPath = join(root, 'my-bad-app')
    let threw = false
    const cwd = new Commander()
    try {
      await newSpaceAction.call(cwd, { template: 'base', renderer: 'vue' }, appPath)
    } catch {
      threw = true
    }
    assert(threw, 'expected newSpaceAction to throw for an unsupported renderer')

    const exists = await Deno.stat(appPath).then(() => true).catch(() => false)
    assertFalse(exists, 'no project folder should be created when renderer validation fails')
  })
})
