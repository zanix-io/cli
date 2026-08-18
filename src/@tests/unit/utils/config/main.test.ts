import { assert, assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { saveZanixConfig } from 'utils/config/main.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

Deno.test(
  'saveZanixConfig writes a fresh base config when nothing exists yet at root (the ' +
    'common `zanix new` case)',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })

    try {
      await saveZanixConfig('server', root)

      const written = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
      assertEquals(written.zanix?.project, 'server')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'saveZanixConfig merges into a real, valid existing config instead of overwriting it',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })

    try {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({ imports: { 'my-own-dep': 'npm:my-own-dep@^1.0.0' } }),
      )

      await saveZanixConfig('server', root)

      const written = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
      assert(
        written.imports?.['my-own-dep'],
        'expected the pre-existing, unrelated import to survive the merge',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'saveZanixConfig throws (never silently overwrites) when an existing config is malformed',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })

    try {
      await Deno.writeTextFile(`${root}/deno.json`, '{ not valid json')
      const before = await Deno.readTextFile(`${root}/deno.json`)

      await assertRejects(() => saveZanixConfig('server', root))

      const after = await Deno.readTextFile(`${root}/deno.json`)
      assertEquals(after, before, 'the malformed file must be left untouched, not overwritten')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
