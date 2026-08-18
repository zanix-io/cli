import { assertEquals, assertStrictEquals } from '@std/assert'
import { getSpaceSrcTree } from 'commands/new/lib/tree/projects/space.ts'
import { getServerSrcTree } from 'commands/new/lib/tree/projects/server.ts'
import { getCommonTree } from 'commands/new/lib/tree/projects/commons.ts'

Deno.test('getSpaceSrcTree returns the cached tree on a second call with the same root', () => {
  const first = getSpaceSrcTree('cache-test-root')
  const second = getSpaceSrcTree('cache-test-root')

  assertStrictEquals(second, first)
})

Deno.test('getServerSrcTree returns the cached tree on a second call with the same root', () => {
  const first = getServerSrcTree('cache-test-root')
  const second = getServerSrcTree('cache-test-root')

  assertStrictEquals(second, first)
})

Deno.test('getCommonTree returns the cached tree on a second call with the same root', () => {
  const first = getCommonTree('cache-test-root')
  const second = getCommonTree('cache-test-root')

  assertStrictEquals(second, first)
})

Deno.test(
  'getCommonTree rebuilds (never returns a stale tree) when the same root is reused for a ' +
    'different project type',
  () => {
    const libraryTree = getCommonTree('cache-test-root-2', 'library')
    const appTree = getCommonTree('cache-test-root-2', 'app')

    const libraryFileNames = (libraryTree.templates?.base ?? []).map((f) => f.NAME)
    const appFileNames = (appTree.templates?.base ?? []).map((f) => f.NAME)

    // Only `library` gets `mod.ts` pushed onto the shared root files (commons.ts:15) — a stale
    // cache hit for `app` would incorrectly carry it over.
    assertEquals(libraryFileNames.includes('mod.ts'), true)
    assertEquals(appFileNames.includes('mod.ts'), false)
  },
)
