import { assertEquals, assertThrows } from '@std/assert'
import { assertKnownPreset, KNOWN_PRESETS } from 'commands/new/lib/tree/presets.ts'

Deno.test('KNOWN_PRESETS only lists base today — the formalized default scaffold', () => {
  assertEquals(KNOWN_PRESETS, ['base'])
})

Deno.test('assertKnownPreset accepts base without throwing', () => {
  assertKnownPreset('base')
})

Deno.test('assertKnownPreset throws a clear, listing error for an unknown preset', () => {
  const error = assertThrows(
    () => assertKnownPreset('does-not-exist'),
    Error,
    "Unknown template 'does-not-exist'",
  )
  assertEquals(
    error.message,
    "Unknown template 'does-not-exist'. Supported templates: base.",
  )
})

Deno.test('assertKnownPreset honors a custom knownPresets list, not the global default', () => {
  assertKnownPreset('alt', ['base', 'alt'])
  assertThrows(
    () => assertKnownPreset('base', ['alt']),
    Error,
    "Unknown template 'base'. Supported templates: alt.",
  )
})
