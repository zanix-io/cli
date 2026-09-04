import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  assertKnownPages,
  KNOWN_PAGES,
  parsePagesFlag,
  writeRequestedPages,
} from 'commands/new/lib/tree/projects/space-pages.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('parsePagesFlag: undefined (the flag was never passed) resolves to an empty list', () => {
  assertEquals(parsePagesFlag(undefined), [])
})

Deno.test('parsePagesFlag: a single value is returned as a one-element list', () => {
  assertEquals(parsePagesFlag('error'), ['error'])
})

Deno.test('parsePagesFlag: splits a comma-separated list, trimming stray whitespace', () => {
  assertEquals(parsePagesFlag('error, not-found'), ['error', 'not-found'])
})

Deno.test('parsePagesFlag: an empty string resolves to an empty list, not [""]', () => {
  assertEquals(parsePagesFlag(''), [])
})

Deno.test('assertKnownPages: every KNOWN_PAGES value passes', () => {
  assertKnownPages([...KNOWN_PAGES])
})

Deno.test('assertKnownPages: an unknown value throws, naming the bad value and the supported list', () => {
  assertThrows(
    () => assertKnownPages(['bogus']),
    Error,
    "Unknown --pages value 'bogus'. Supported values: error, not-found.",
  )
})

Deno.test(
  "writeRequestedPages: ['error'] writes ONLY routes/error.tsx, matching zanix generate error's " +
    'own root-level (empty route path) output',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await writeRequestedPages(root, ['error'])

      const errorContent = await Deno.readTextFile(
        join(root, 'src', 'space', 'routes', 'error.tsx'),
      )
      assert(errorContent.includes('export default function IndexError'), errorContent)
      assert(errorContent.includes('ErrorBoundaryProps'), errorContent)

      await assertRejects(
        () => Deno.readTextFile(join(root, 'src', 'space', 'routes', 'not-found.tsx')),
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "writeRequestedPages: ['not-found'] writes ONLY routes/not-found.tsx, matching " +
    "zanix generate not-found's own output exactly",
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await writeRequestedPages(root, ['not-found'])

      const notFoundContent = await Deno.readTextFile(
        join(root, 'src', 'space', 'routes', 'not-found.tsx'),
      )
      assert(notFoundContent.includes('export default function NotFound'), notFoundContent)
      assert(notFoundContent.includes('404'), notFoundContent)

      await assertRejects(
        () => Deno.readTextFile(join(root, 'src', 'space', 'routes', 'error.tsx')),
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "writeRequestedPages: ['error', 'not-found'] writes BOTH files into the same routesDir",
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await writeRequestedPages(root, ['error', 'not-found'])

      const routesDir = join(root, 'src', 'space', 'routes')
      assert(await Deno.readTextFile(join(routesDir, 'error.tsx')))
      assert(await Deno.readTextFile(join(routesDir, 'not-found.tsx')))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('writeRequestedPages: an empty list writes nothing at all — no routes dir created', async () => {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await writeRequestedPages(root, [])
  await assertRejects(() => Deno.stat(join(root, 'src', 'space', 'routes')))
})

// ================================================================================================
// ensureSpaceScaffoldSideEffects's own `pages` param — proves the flag is genuinely wired through
// the real orchestrator (not just the standalone writer above), and independent of `preset`/
// `icons`/`theme`, same "no network involved" guarantee `--icons: false` cases already have.
// ================================================================================================

Deno.test(
  'ensureSpaceScaffoldSideEffects: pages defaults to an empty list — omitting --pages never ' +
    'writes error.tsx/not-found.tsx',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await ensureSpaceScaffoldSideEffects(root, 'base')

      await assertRejects(() =>
        Deno.readTextFile(join(root, 'src', 'space', 'routes', 'error.tsx'))
      )
      await assertRejects(
        () => Deno.readTextFile(join(root, 'src', 'space', 'routes', 'not-found.tsx')),
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "ensureSpaceScaffoldSideEffects: pages: ['error', 'not-found'] lands both files, independent " +
    "of preset — 'welcome' behaves exactly the same as 'base'",
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await ensureSpaceScaffoldSideEffects(root, 'welcome', false, 'react', undefined, [
        'error',
        'not-found',
      ])

      const routesDir = join(root, 'src', 'space', 'routes')
      assert(await Deno.readTextFile(join(routesDir, 'error.tsx')))
      assert(await Deno.readTextFile(join(routesDir, 'not-found.tsx')))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
