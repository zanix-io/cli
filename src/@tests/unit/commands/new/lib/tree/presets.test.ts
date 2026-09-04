import { assertEquals, assertThrows } from '@std/assert'
import { assertKnownPreset, KNOWN_PRESETS } from 'commands/new/lib/tree/presets.ts'

Deno.test('KNOWN_PRESETS lists all four real --template values today', () => {
  assertEquals(KNOWN_PRESETS, ['base', 'welcome', 'population', 'population-lang'])
})

Deno.test('assertKnownPreset accepts base without throwing', () => {
  assertKnownPreset('base')
})

Deno.test('assertKnownPreset accepts welcome without throwing', () => {
  assertKnownPreset('welcome')
})

Deno.test('assertKnownPreset accepts population without throwing', () => {
  assertKnownPreset('population')
})

Deno.test('assertKnownPreset accepts population-lang without throwing', () => {
  assertKnownPreset('population-lang')
})

Deno.test('assertKnownPreset throws a clear, listing error for an unknown preset', () => {
  const error = assertThrows(
    () => assertKnownPreset('does-not-exist'),
    Error,
    "Unknown template 'does-not-exist'",
  )
  assertEquals(
    error.message,
    "Unknown template 'does-not-exist'. Supported templates: base, welcome, population, " +
      'population-lang.',
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
