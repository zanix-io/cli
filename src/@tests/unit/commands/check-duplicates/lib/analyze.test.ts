import { assertEquals } from '@std/assert'
import { findDuplicateZanixDeps } from 'commands/check-duplicates/lib/analyze.ts'

Deno.test(
  'findDuplicateZanixDeps flags a @zanix/* package resolved to more than one version',
  () => {
    const findings = findDuplicateZanixDeps({
      'jsr:@zanix/auth@~0.8.1': '0.8.1',
      'jsr:@zanix/auth@0.8.1': '0.8.1',
      'jsr:@zanix/auth@^1.0.0': '1.0.0',
      'jsr:@zanix/server@^4.0.0': '4.0.0',
      'npm:zod@^4.1.13': '4.4.3',
    })

    assertEquals(findings, [{
      name: '@zanix/auth',
      versions: [
        { version: '0.8.1', specifiers: ['jsr:@zanix/auth@~0.8.1', 'jsr:@zanix/auth@0.8.1'] },
        { version: '1.0.0', specifiers: ['jsr:@zanix/auth@^1.0.0'] },
      ],
    }])
  },
)

Deno.test('findDuplicateZanixDeps reports clean when every @zanix/* package resolves once', () => {
  const findings = findDuplicateZanixDeps({
    'jsr:@zanix/auth@~0.8.1': '0.8.1',
    'jsr:@zanix/server@^4.0.0': '4.0.0',
    'npm:zod@^4.1.13': '4.4.3',
  })

  assertEquals(findings, [])
})

Deno.test('findDuplicateZanixDeps ignores non-@zanix specifiers entirely', () => {
  const findings = findDuplicateZanixDeps({
    'jsr:@std/path@0.224': '0.224.0',
    'jsr:@std/path@1': '1.1.6',
    'npm:mongoose@8': '8.24.4',
  })

  assertEquals(findings, [])
})

Deno.test('findDuplicateZanixDeps sorts findings by package name', () => {
  const findings = findDuplicateZanixDeps({
    'jsr:@zanix/notifications@0.7': '0.7.0',
    'jsr:@zanix/notifications@^1.0.0': '1.0.0',
    'jsr:@zanix/auth@~0.8.1': '0.8.1',
    'jsr:@zanix/auth@^1.0.0': '1.0.0',
  })

  assertEquals(findings.map((f) => f.name), ['@zanix/auth', '@zanix/notifications'])
})
