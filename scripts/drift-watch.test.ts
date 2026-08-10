import { assertEquals, assertThrows } from '@std/assert'
import { parseSpecifier } from './drift-watch.ts'

Deno.test('parseSpecifier parses a plain package specifier', () => {
  assertEquals(parseSpecifier('jsr:@zanix/server@^3.1.0'), { pkg: '@zanix/server', subpath: '' })
})

Deno.test('parseSpecifier parses a specifier with a version range using *', () => {
  assertEquals(parseSpecifier('jsr:@zanix/utils@2.*'), { pkg: '@zanix/utils', subpath: '' })
})

Deno.test('parseSpecifier parses a subpath alias specifier', () => {
  assertEquals(
    parseSpecifier('jsr:@zanix/utils@2.*/validator'),
    { pkg: '@zanix/utils', subpath: '/validator' },
  )
})

Deno.test('parseSpecifier parses a nested subpath', () => {
  assertEquals(
    parseSpecifier('jsr:@zanix/app@^0.1.0/runtime'),
    { pkg: '@zanix/app', subpath: '/runtime' },
  )
})

Deno.test('parseSpecifier throws for a non-jsr specifier', () => {
  assertThrows(() => parseSpecifier('npm:react@^19.2.0'), Error, 'Cannot parse specifier')
})
