import { assertStrictEquals } from '@std/assert'
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
