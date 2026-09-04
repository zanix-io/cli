import { assertEquals } from '@std/assert'
import { formatReport } from 'commands/check-duplicates/lib/report.ts'
import type { DuplicateFinding } from 'commands/check-duplicates/lib/analyze.ts'

Deno.test('formatReport reports clean when there are no findings', () => {
  const report = formatReport('/repo', [])

  assertEquals(
    report,
    "/repo: current (deno.lock resolves exactly one version per '@zanix/*' package)",
  )
})

Deno.test('formatReport lists every duplicated package with its resolved versions and specifiers', () => {
  const findings: DuplicateFinding[] = [{
    name: '@zanix/auth',
    versions: [
      { version: '0.8.1', specifiers: ['jsr:@zanix/auth@~0.8.1'] },
      { version: '1.0.0', specifiers: ['jsr:@zanix/auth@^1.0.0'] },
    ],
  }]

  const report = formatReport('/repo', findings)

  assertEquals(
    report,
    "@zanix/auth: resolves to 2 distinct versions at once — '0.8.1' " +
      "(via jsr:@zanix/auth@~0.8.1) and '1.0.0' (via jsr:@zanix/auth@^1.0.0)",
  )
})
