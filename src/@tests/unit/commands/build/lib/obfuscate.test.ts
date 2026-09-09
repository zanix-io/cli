import { assertEquals } from '@std/assert'
import { excludeObfuscationTargets } from 'commands/build/lib/obfuscate.ts'

const PATHS = [
  'assets/counter-abc123.js',
  'assets/monaco-def456.js',
  'assets/mouseTarget-ghi789.js',
  'sw.js',
]

Deno.test('excludeObfuscationTargets: no excludeGlobs is a no-op', () => {
  assertEquals(excludeObfuscationTargets(PATHS), PATHS)
  assertEquals(excludeObfuscationTargets(PATHS, ''), PATHS)
  assertEquals(excludeObfuscationTargets(PATHS, '   '), PATHS)
})

Deno.test('excludeObfuscationTargets: a single glob drops only matching paths', () => {
  assertEquals(excludeObfuscationTargets(PATHS, 'assets/monaco*.js'), [
    'assets/counter-abc123.js',
    'assets/mouseTarget-ghi789.js',
    'sw.js',
  ])
})

Deno.test('excludeObfuscationTargets: comma-separated globs combine, and trim whitespace', () => {
  assertEquals(
    excludeObfuscationTargets(PATHS, ' assets/monaco*.js , assets/mouseTarget*.js '),
    ['assets/counter-abc123.js', 'sw.js'],
  )
})

Deno.test('excludeObfuscationTargets: matches a bare file name like sw.js', () => {
  assertEquals(excludeObfuscationTargets(PATHS, 'sw.js'), [
    'assets/counter-abc123.js',
    'assets/monaco-def456.js',
    'assets/mouseTarget-ghi789.js',
  ])
})

Deno.test('excludeObfuscationTargets: a glob matching nothing changes nothing', () => {
  assertEquals(excludeObfuscationTargets(PATHS, 'assets/does-not-exist*.js'), PATHS)
})
