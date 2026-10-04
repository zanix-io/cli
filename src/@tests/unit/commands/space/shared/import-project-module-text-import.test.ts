import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import {
  cleanupImportBatch,
  createImportBatchContext,
  importProjectModule,
} from 'commands/space/shared/import-project-module.ts'

// A PLAIN system temp dir, as `import-project-module.test.ts` explains: the fixture simulates a real
// consuming project's own root.

Deno.test(
  'importProjectModule: a stylesheet imported with `type: "text"` yields its real text, while a ' +
    'plain import of the same file keeps the empty CSS Modules stub',
  async () => {
    const root = await Deno.makeTempDir()
    const batch = createImportBatchContext()
    try {
      await Deno.writeTextFile(join(root, 'deno.json'), '{}\n')
      await Deno.writeTextFile(join(root, 'x.css'), '.marker { color: red; }\n')
      await Deno.writeTextFile(
        join(root, 'text.ts'),
        `import css from './x.css' with { type: 'text' }
export { css }
`,
      )
      await Deno.writeTextFile(
        join(root, 'mixed.ts'),
        `import css from './x.css' with { type: 'text' }
import mapping from './x.css'
export { css, mapping }
`,
      )
      await Deno.writeTextFile(
        join(root, 'plain.module.ts'),
        `import mapping from './x.css'
export { mapping }
`,
      )

      const text = await importProjectModule(join(root, 'text.ts'), batch)
      assertEquals(text.css, '.marker { color: red; }\n')

      // The same file imported both ways in one graph never mixes the two answers.
      const mixed = await importProjectModule(join(root, 'mixed.ts'), batch)
      assertEquals(mixed.css, '.marker { color: red; }\n')
      assertEquals(mixed.mapping, {})

      const plain = await importProjectModule(join(root, 'plain.module.ts'), batch)
      assertEquals(plain.mapping, {})
    } finally {
      await cleanupImportBatch(batch)
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'importProjectModule: a dynamic import with a `type: "text"` attribute reads the real text',
  async () => {
    const root = await Deno.makeTempDir()
    const batch = createImportBatchContext()
    try {
      await Deno.writeTextFile(join(root, 'deno.json'), '{}\n')
      await Deno.writeTextFile(join(root, 'x.css'), '.dyn { margin: 0; }\n')
      await Deno.writeTextFile(
        join(root, 'dyn.ts'),
        `export const css = (await import('./x.css', { with: { type: 'text' } })).default
`,
      )
      const loaded = await importProjectModule(join(root, 'dyn.ts'), batch)
      assertEquals(loaded.css, '.dyn { margin: 0; }\n')
    } finally {
      await cleanupImportBatch(batch)
      await Deno.remove(root, { recursive: true })
    }
  },
)
