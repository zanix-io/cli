import { assertEquals } from '@std/assert'
import {
  planAlignment,
  projectZanixImportKeys,
  versionSatisfiesRange,
} from 'commands/space/shared/project-dependency-alignment.ts'
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

Deno.test('planAlignment: moves every admitting range of a package to the project version, across packages', () => {
  const plan = planAlignment(
    {
      specifiers: {
        'jsr:@zanix/space-ui@^2.3.0': '2.4.3',
        'jsr:@zanix/space-ui@^2.4.0': '2.4.3',
        'jsr:@zanix/space@^1.6.0': '1.6.0',
        'jsr:@zanix/utils@^4.1.0': '4.7.1',
      },
      jsr: { '@zanix/space@1.16.3': {} },
    },
    new Map([['@zanix/space-ui', '2.5.3'], ['@zanix/space', '1.16.3'], ['@zanix/utils', '4.7.1']]),
  )

  assertEquals(plan.specifiers, {
    'jsr:@zanix/space-ui@^2.3.0': '2.5.3',
    'jsr:@zanix/space-ui@^2.4.0': '2.5.3',
    'jsr:@zanix/space@^1.6.0': '1.16.3',
  })
  assertEquals([...plan.packages], [
    ['@zanix/space', { version: '1.16.3', pins: ['1.6.0'] }],
    ['@zanix/space-ui', { version: '2.5.3', pins: ['2.4.3'] }],
  ])
  assertEquals(
    plan.missingBlocks,
    ['@zanix/space-ui@2.5.3'],
    'a block the lock already has is not fetched',
  )
  assertEquals(plan.unalignable, [])
})

Deno.test('planAlignment: a range that does not admit the project version keeps its pin and is reported', () => {
  const plan = planAlignment(
    { specifiers: { 'jsr:@zanix/utils@^3.0.1': '3.1.2', 'jsr:@zanix/utils@~4.6.0': '4.6.2' } },
    new Map([['@zanix/utils', '4.7.1']]),
  )

  assertEquals(plan.specifiers, {})
  assertEquals(plan.packages.size, 0)
  assertEquals(plan.unalignable, [
    { range: 'jsr:@zanix/utils@^3.0.1', pin: '3.1.2', version: '4.7.1', reason: 'range' },
    { range: 'jsr:@zanix/utils@~4.6.0', pin: '4.6.2', version: '4.7.1', reason: 'range' },
  ])
})

Deno.test('planAlignment: a major-0 or prerelease project version is never aligned nor reported', () => {
  const plan = planAlignment(
    {
      specifiers: { 'jsr:@zanix/asyncmq@0.8': '0.8.0', 'jsr:@zanix/app@^1.0.0': '1.0.2' },
    },
    new Map([['@zanix/asyncmq', '0.9.0'], ['@zanix/app', '1.1.0-rc.1']]),
  )

  assertEquals(plan.specifiers, {})
  assertEquals(plan.unalignable, [])
})

Deno.test('projectZanixImportKeys: one key per @zanix/* package, member first, @zanix/cli excluded', async () => {
  const base = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(
      `${base}/deno.json`,
      JSON.stringify({
        workspace: ['./member'],
        imports: {
          '@zanix/utils': 'jsr:@zanix/utils@^4.1.0',
          '@zanix/space': 'jsr:@zanix/space@^1.0.0',
        },
      }),
    )
    await Deno.mkdir(`${base}/member`)
    await Deno.writeTextFile(
      `${base}/member/deno.json`,
      JSON.stringify({
        imports: {
          '@zanix/space-ui/preact': 'jsr:@zanix/space-ui@^2.5.3/preact',
          '@zanix/space': 'jsr:@zanix/space@^1.16.0',
          '@zanix/cli': 'jsr:@zanix/cli@^2.2.0',
          '@std/path': 'jsr:@std/path@^1.0.0',
        },
      }),
    )

    assertEquals(
      [...projectZanixImportKeys(`${base}/member`)].sort(),
      [
        ['@zanix/space', '@zanix/space'],
        ['@zanix/space-ui', '@zanix/space-ui/preact'],
        ['@zanix/utils', '@zanix/utils'],
      ],
    )
  } finally {
    await Deno.remove(base, { recursive: true })
  }
})

Deno.test('planAlignment: a pin newer than the project version is kept and reported, except for @zanix/space', () => {
  const plan = planAlignment(
    {
      specifiers: {
        'jsr:@zanix/utils@^4.5.0': '4.7.1',
        'jsr:@zanix/utils@^4.1.0': '4.5.0',
        'jsr:@zanix/space@^1.6.0': '1.16.3',
      },
      jsr: { '@zanix/utils@4.6.0': {}, '@zanix/space@1.16.0': {} },
    },
    new Map([['@zanix/utils', '4.6.0'], ['@zanix/space', '1.16.0']]),
  )

  assertEquals(plan.specifiers, {
    'jsr:@zanix/utils@^4.1.0': '4.6.0',
    'jsr:@zanix/space@^1.6.0': '1.16.0',
  })
  assertEquals(plan.unalignable, [
    { range: 'jsr:@zanix/utils@^4.5.0', pin: '4.7.1', version: '4.6.0', reason: 'older' },
  ])
})
