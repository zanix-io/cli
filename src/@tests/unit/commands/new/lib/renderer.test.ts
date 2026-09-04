import { assertEquals, assertThrows } from '@std/assert'
import { assertValidRenderer, getHooksEntry, getSpaceUiEntry } from 'commands/new/lib/renderer.ts'

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

// ================================================================================================
// getSpaceUiEntry/getHooksEntry — the shared helpers every renderer-aware generated template
// (`space-icons.ts`, `space-welcome.ts`, `space-astronaut.ts`) resolves its own `@zanix/space-ui`/
// hooks import through, instead of each re-declaring the same ternary independently.
// ================================================================================================

Deno.test('getSpaceUiEntry: undefined or react resolves to the React entrypoint', () => {
  assertEquals(getSpaceUiEntry(), '@zanix/space-ui')
  assertEquals(getSpaceUiEntry('react'), '@zanix/space-ui')
})

Deno.test("getSpaceUiEntry: 'preact' resolves to the /preact entrypoint", () => {
  assertEquals(getSpaceUiEntry('preact'), '@zanix/space-ui/preact')
})

Deno.test('getHooksEntry: undefined or react resolves to plain react', () => {
  assertEquals(getHooksEntry(), 'react')
  assertEquals(getHooksEntry('react'), 'react')
})

Deno.test("getHooksEntry: 'preact' resolves to preact/hooks, never preact/compat", () => {
  assertEquals(getHooksEntry('preact'), 'preact/hooks')
})
