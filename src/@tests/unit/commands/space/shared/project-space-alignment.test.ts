import { assertEquals } from '@std/assert'
import { versionSatisfiesRange } from 'commands/space/shared/project-space-alignment.ts'
import { jsrPackageVersionFromResolvedUrl } from 'commands/space/shared/transitive-collision.ts'

Deno.test('versionSatisfiesRange: a bare major admits any release of that major', () => {
  assertEquals(versionSatisfiesRange('1.16.3', '1'), true)
  assertEquals(versionSatisfiesRange('2.0.0', '1'), false)
})

Deno.test('versionSatisfiesRange: caret admits the same major at or above its lower bound', () => {
  assertEquals(versionSatisfiesRange('1.16.3', '^1.16.0'), true)
  assertEquals(versionSatisfiesRange('1.16.0', '^1.16.0'), true)
  assertEquals(versionSatisfiesRange('1.17.0', '^1.16.0'), true)
  assertEquals(versionSatisfiesRange('1.15.9', '^1.16.0'), false)
  assertEquals(versionSatisfiesRange('2.0.0', '^1.16.0'), false)
  assertEquals(versionSatisfiesRange('1.0.5', '^1'), true)
})

Deno.test('versionSatisfiesRange: tilde admits the same major.minor at or above its patch', () => {
  assertEquals(versionSatisfiesRange('1.16.3', '~1.16.2'), true)
  assertEquals(versionSatisfiesRange('1.16.1', '~1.16.2'), false)
  assertEquals(versionSatisfiesRange('1.17.0', '~1.16.2'), false)
  assertEquals(versionSatisfiesRange('1.9.0', '~1'), true)
})

Deno.test('versionSatisfiesRange: a range without an operator matches the parts it spells out', () => {
  assertEquals(versionSatisfiesRange('1.16.3', '1.16'), true)
  assertEquals(versionSatisfiesRange('1.17.0', '1.16'), false)
  assertEquals(versionSatisfiesRange('1.16.3', '1.16.3'), true)
  assertEquals(versionSatisfiesRange('1.16.4', '1.16.3'), false)
})

Deno.test('versionSatisfiesRange: major 0 never matches, whatever the operator', () => {
  assertEquals(versionSatisfiesRange('0.5.2', '^0.5.0'), false)
  assertEquals(versionSatisfiesRange('0.5.2', '~0.5.0'), false)
  assertEquals(versionSatisfiesRange('0.5.2', '0.5.2'), false)
  assertEquals(versionSatisfiesRange('0.5.2', '0'), false)
})

Deno.test('versionSatisfiesRange: a prerelease version or an unsupported range syntax never matches', () => {
  assertEquals(versionSatisfiesRange('1.16.3-rc.1', '^1.16.0'), false)
  assertEquals(versionSatisfiesRange('1.16.3', '^1.16.0-rc.1'), false)
  assertEquals(versionSatisfiesRange('1.16.3', '>=1.16.0'), false)
  assertEquals(versionSatisfiesRange('1.16.3', '1.x'), false)
  assertEquals(versionSatisfiesRange('1.16.3', '*'), false)
  assertEquals(versionSatisfiesRange('not-a-version', '^1.0.0'), false)
})

Deno.test('jsrPackageVersionFromResolvedUrl: reads the version from a JSR module URL only', () => {
  assertEquals(
    jsrPackageVersionFromResolvedUrl('https://jsr.io/@zanix/space/1.16.3/mod.ts'),
    '1.16.3',
  )
  assertEquals(jsrPackageVersionFromResolvedUrl('file:///project/mod.ts'), undefined)
  assertEquals(jsrPackageVersionFromResolvedUrl('npm:react@^19.0.0'), undefined)
})
