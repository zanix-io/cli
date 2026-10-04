import { assert, assertEquals } from '@std/assert'
import { join, resolve, toFileUrl } from '@std/path'
import {
  cleanupImportBatch,
  createImportBatchContext,
  importProjectModule,
} from 'commands/space/shared/import-project-module.ts'

// A PLAIN system temp dir, as `import-project-module.test.ts` explains: the fixture simulates a real
// consuming project's own root.

Deno.test(
  'importProjectModule: a rewritten module reports its ORIGINAL file as import.meta.url and ' +
    'import.meta.filename, and a relative reference still reaches its real sibling',
  async () => {
    const root = await Deno.makeTempDir()
    const batch = createImportBatchContext()
    try {
      await Deno.writeTextFile(join(root, 'deno.json'), '{}\n')
      await Deno.writeTextFile(join(root, 'sibling.txt'), 'sibling-marker')
      await Deno.writeTextFile(
        join(root, 'dep.ts'),
        `export const url = import.meta.url
export const sibling = Deno.readTextFileSync(new URL('./sibling.txt', import.meta.url))
`,
      )
      await Deno.writeTextFile(
        join(root, 'entry.ts'),
        `import { url as depUrl } from './dep.ts'
export const url = import.meta.url
export const filename = import.meta.filename
export const dirname = import.meta.dirname
export const quoted = 'import.meta.url'
export const sibling = Deno.readTextFileSync(new URL('./sibling.txt', import.meta.url))
export { depUrl }
`,
      )

      const entryPath = join(root, 'entry.ts')
      const loaded = await importProjectModule(entryPath, batch)
      const originalUrl = toFileUrl(resolve(entryPath)).href

      // The module the CLI actually ran was a temporary copy, and it says it is the original.
      assertEquals(loaded.url, originalUrl)
      assertEquals(loaded.filename, resolve(entryPath))
      assert(!String(loaded.url).includes('.zanix-import-'), String(loaded.url))
      // A module reached through a relative import is pinned too.
      assertEquals(loaded.depUrl, toFileUrl(resolve(join(root, 'dep.ts'))).href)
      // Relative references keep their meaning, and the same text in a string is left alone.
      assertEquals(loaded.sibling, 'sibling-marker')
      assertEquals(loaded.quoted, 'import.meta.url')
      assertEquals(loaded.dirname, resolve(root))
    } finally {
      await cleanupImportBatch(batch)
      await Deno.remove(root, { recursive: true })
    }
  },
)
