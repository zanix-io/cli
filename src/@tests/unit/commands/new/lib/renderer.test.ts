import { assertEquals, assertThrows } from '@std/assert'
import { assertValidRenderer } from 'commands/new/lib/renderer.ts'

Deno.test('assertValidRenderer: undefined defaults to react', () => {
  assertEquals(assertValidRenderer(undefined), 'react')
})

Deno.test("assertValidRenderer: 'react' passes through unchanged", () => {
  assertEquals(assertValidRenderer('react'), 'react')
})

Deno.test("assertValidRenderer: 'preact' passes through unchanged", () => {
  assertEquals(assertValidRenderer('preact'), 'preact')
})

Deno.test('assertValidRenderer: an unsupported value throws a clear error', () => {
  assertThrows(
    () => assertValidRenderer('vue'),
    Error,
    "Unsupported renderer 'vue'. Supported renderers: react, preact.",
  )
})
