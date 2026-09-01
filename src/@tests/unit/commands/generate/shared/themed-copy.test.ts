import { assertEquals } from '@std/assert'
import { resolveThemedCopy } from 'commands/generate/shared/themed-copy.ts'

Deno.test('resolveThemedCopy returns the table entry for a known theme', () => {
  const result = resolveThemedCopy('astronaut', { astronaut: 'rocket' }, 'default-copy')
  assertEquals(result, 'rocket')
})

Deno.test('resolveThemedCopy falls back when the theme has no table entry', () => {
  const result = resolveThemedCopy('default', { astronaut: 'rocket' }, 'default-copy')
  assertEquals(result, 'default-copy')
})

Deno.test('resolveThemedCopy falls back when theme is undefined (no theme installed)', () => {
  const result = resolveThemedCopy(undefined, { astronaut: 'rocket' }, 'default-copy')
  assertEquals(result, 'default-copy')
})
