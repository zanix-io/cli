import { assertEquals, assertThrows } from '@std/assert'
import { assertKnownTheme, KNOWN_THEMES } from 'commands/new/lib/tree/themes.ts'

Deno.test('KNOWN_THEMES lists default and astronaut — the two real --theme values today', () => {
  assertEquals(KNOWN_THEMES, ['default', 'astronaut'])
})

Deno.test('assertKnownTheme accepts default without throwing', () => {
  assertKnownTheme('default')
})

Deno.test('assertKnownTheme accepts astronaut without throwing', () => {
  assertKnownTheme('astronaut')
})

Deno.test('assertKnownTheme throws a clear, listing error for an unknown theme', () => {
  const error = assertThrows(
    () => assertKnownTheme('does-not-exist'),
    Error,
    "Unknown theme 'does-not-exist'",
  )
  assertEquals(
    error.message,
    "Unknown theme 'does-not-exist'. Supported themes: default, astronaut.",
  )
})

Deno.test('assertKnownTheme honors a custom knownThemes list, not the global default', () => {
  assertKnownTheme('alt', ['default', 'alt'])
  assertThrows(
    () => assertKnownTheme('default', ['alt']),
    Error,
    "Unknown theme 'default'. Supported themes: alt.",
  )
})
