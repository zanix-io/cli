import { assert, assertEquals } from '@std/assert'
import type { Diagnostic } from '@zanix/space'
import logger from '@zanix/utils/logger'
import { reportValidation } from 'commands/space/shared/report-validation.ts'

// ================================================================================================
// PRESENTATION — and the boundary it must not cross.
//
// This module now types its input with the real `Diagnostic` from `@zanix/space`, imported as a
// TYPE only. Two things are under test, and they pull in opposite directions:
//
// 1. Presentation keeps working, and stays presentation: it decides wording and destination, never
//    severity, ordering, filtering or whether something blocks.
// 2. Using the real contract type must not smuggle a RUNTIME dependency on the validation engine
//    into a module that only prints. A type-only import is erased; a value import would not be.
// ================================================================================================

/** A complete, real `Diagnostic` — every field the contract defines, so this fixture cannot drift
 * into a partial shape the way a hand-written structural type could. */
function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: 'DOC001',
    category: 'html',
    severity: 'warning',
    resolution: { catalog: 'warning', strictPromoted: false, effective: 'warning' },
    phase: 'static',
    basis: 'spec',
    message: "Route 'products' resolves no <title>.",
    file: 'routes/products/page.tsx',
    route: 'products',
    hint: 'Declare `static head = { title: ... }`.',
    ...overrides,
  }
}

/**
 * Captures every logger call the reporter makes, as `[channel, firstArg, ...rest]`.
 *
 * One helper for all of these, because all output now goes through the logger — an earlier version
 * stubbed `console.log` for some assertions and the logger for others, which meant a test could
 * pass while silently observing the wrong channel.
 */
function captureLogger(
  run: () => boolean,
): { calls: unknown[][]; channels: string[]; blocking: boolean } {
  const calls: unknown[][] = []
  const channels: string[] = []
  const original = {
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    success: logger.success,
  }
  const stub = (channel: string) => (...args: unknown[]) => {
    channels.push(channel)
    calls.push(args)
  }
  logger.info = stub('info') as typeof logger.info
  logger.warn = stub('warn') as typeof logger.warn
  logger.error = stub('error') as typeof logger.error
  logger.success = stub('success') as typeof logger.success
  try {
    return { blocking: run(), calls, channels }
  } finally {
    Object.assign(logger, original)
  }
}

Deno.test('reportValidation: returns the blocking flag it was given, never one it computed', () => {
  for (const blocking of [true, false]) {
    const { blocking: returned } = captureLogger(() =>
      reportValidation({
        diagnostics: [diagnostic({ severity: 'error' })],
        skipped: [],
        entries: [{ severity: 'warning', text: 'x' }],
        blocking,
      })
    )
    // The diagnostic says `error` in both runs; the return value follows the FLAG, not the finding.
    // That is the proof this module applies no severity policy of its own.
    assertEquals(returned, blocking)
  }
})

Deno.test(
  'reportValidation: routes each finding to the logger channel matching its severity, so an error ' +
    'is visually an error. It never re-renders a finding from its fields — the text it was handed ' +
    'is what gets printed, so wording stays the validation module`s decision',
  () => {
    const seen: Array<[string, string]> = []
    const stub = (channel: string) => (...args: unknown[]) => {
      seen.push([channel, String(args[0])])
    }
    const original = { info: logger.info, warn: logger.warn, error: logger.error }
    logger.info = stub('info') as typeof logger.info
    logger.warn = stub('warn') as typeof logger.warn
    logger.error = stub('error') as typeof logger.error
    try {
      reportValidation({
        diagnostics: [
          diagnostic(),
          diagnostic({ severity: 'error' }),
          diagnostic({ severity: 'info' }),
        ],
        skipped: [],
        entries: [
          { severity: 'warning', text: 'W-TEXT' },
          { severity: 'error', text: 'E-TEXT' },
          { severity: 'info', text: 'I-TEXT' },
        ],
        blocking: true,
      })
    } finally {
      logger.info = original.info
      logger.warn = original.warn
      logger.error = original.error
    }

    // One call per severity present, each carrying its own header AND its own findings.
    assert(
      seen.some(([c, t]) => c === 'error' && t.includes('1 error') && t.includes('E-TEXT')),
      JSON.stringify(seen),
    )
    assert(
      seen.some(([c, t]) => c === 'warn' && t.includes('1 warning') && t.includes('W-TEXT')),
      JSON.stringify(seen),
    )
    assert(
      seen.some(([c, t]) => c === 'info' && t.includes('1 info') && t.includes('I-TEXT')),
      JSON.stringify(seen),
    )
  },
)

Deno.test(
  "reportValidation: EVERY logger call passes 'noSave'. `logger.warn`/`logger.error` persist by " +
    'default (unlike `debug`/`success`), and build feedback is for whoever is watching the ' +
    "terminal — it must not accumulate in the app's own log store, one entry per warning per build",
  () => {
    const calls: unknown[][] = []
    const stub = (...args: unknown[]) => {
      calls.push(args)
    }
    const original = { info: logger.info, warn: logger.warn, error: logger.error }
    logger.info = stub as typeof logger.info
    logger.warn = stub as typeof logger.warn
    logger.error = stub as typeof logger.error
    try {
      reportValidation({
        diagnostics: [diagnostic(), diagnostic({ severity: 'error' })],
        skipped: ['a check that could not run'],
        entries: [
          { severity: 'warning', text: 'W' },
          { severity: 'error', text: 'E' },
        ],
        blocking: true,
      })
    } finally {
      logger.info = original.info
      logger.warn = original.warn
      logger.error = original.error
    }

    assert(calls.length > 0, 'expected logger output')
    for (const args of calls) {
      assertEquals(args[args.length - 1], 'noSave', `missing 'noSave' in: ${JSON.stringify(args)}`)
    }
  },
)

Deno.test(
  'reportValidation: skipped checks are printed even when there are no findings — "clean" and ' +
    '"not checked" must be distinguishable',
  () => {
    const { calls } = captureLogger(() =>
      reportValidation({
        diagnostics: [],
        skipped: ['Sitemap cross-checks: the app declares no sitemap.'],
        entries: [],
        blocking: false,
      })
    )
    assert(
      calls.some((args) => String(args[0]).includes('Sitemap cross-checks')),
      JSON.stringify(calls),
    )
  },
)

Deno.test('reportValidation: no findings and nothing skipped prints neither section', () => {
  const { channels } = captureLogger(() =>
    reportValidation({
      diagnostics: [],
      skipped: [],
      entries: [],
      blocking: false,
    })
  )
  // Only the "no issues" success line — no findings section, no "Not checked" section.
  assertEquals(channels, ['success'])
})

Deno.test(
  'reportValidation: accepts a diagnostic carrying `basis` and a full `resolution` — the fields a ' +
    'structural `{ severity }` shape hid, and which presentation will need to explain why a warning ' +
    'became an error',
  () => {
    const promoted = diagnostic({
      severity: 'error',
      resolution: {
        catalog: 'warning',
        override: 'warning',
        strictPromoted: true,
        effective: 'error',
      },
    })
    assertEquals(promoted.resolution.strictPromoted, true)
    assertEquals(promoted.basis, 'spec')
    // Accepted by the report type without any cast or widening.
    const { blocking } = captureLogger(() =>
      reportValidation({
        diagnostics: [promoted],
        skipped: [],
        entries: [{ severity: 'warning', text: 'x' }],
        blocking: true,
      })
    )
    assertEquals(blocking, true)
  },
)

Deno.test(
  'ARCHITECTURE: the module imports `Diagnostic` as a TYPE only. A value import would pull the ' +
    'validation engine into a file that merely prints, which is the dependency the previous ' +
    'structural type existed to avoid',
  async () => {
    const source = await Deno.readTextFile('src/commands/space/shared/report-validation.ts')
    const spaceImports = [...source.matchAll(/^import\s+(type\s+)?.*from\s+'@zanix\/space'/gm)]
    assertEquals(spaceImports.length, 1, 'expected exactly one @zanix/space import')
    assert(spaceImports[0][1] !== undefined, '@zanix/space must be imported with `import type`')
  },
)

Deno.test(
  'ARCHITECTURE: presentation applies no policy — no severity resolution, no sorting, no ' +
    'filtering, and no rule codes',
  async () => {
    const source = await Deno.readTextFile('src/commands/space/shared/report-validation.ts')
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')

    // `.filter(` is deliberately NOT on this list any more. The reporter groups entries by
    // severity to lay them out, which is presentation: it decides where a finding is printed, never
    // how severe it is. What must stay forbidden is deciding or reordering severity — and the
    // separate "nothing is dropped" test below covers the one real risk a filter introduces.
    for (
      const forbidden of [
        'resolveSeverity',
        'strictPromoted',
        'sortDiagnostics',
        'localeCompare',
        '.sort(',
      ]
    ) {
      assert(!code.includes(forbidden), `presentation must not reference '${forbidden}'`)
    }
    assert(!/['"](DOC|A11Y|SEO|FW|PWA|SOC)\d{3}['"]/.test(code), 'must not know rule codes')
  },
)

Deno.test(
  'reportValidation: a header is never emitted apart from the findings it describes — both live in ' +
    "ONE message, so a run's shape does not have to be reconstructed from consecutive lines",
  () => {
    const { calls, channels } = captureLogger(() =>
      reportValidation({
        diagnostics: [diagnostic(), diagnostic()],
        skipped: [],
        entries: [
          { severity: 'warning', text: 'DOC001  first' },
          { severity: 'warning', text: 'SEO001  second' },
        ],
        blocking: false,
      })
    )
    assertEquals(channels, ['warn'])
    const message = String(calls[0][0])
    assert(message.startsWith('Document validation: 2 warnings'), message)
    assert(message.includes('- DOC001  first'), message)
    assert(message.includes('- SEO001  second'), message)
  },
)

Deno.test(
  'reportValidation: pluralization follows the count, and `info` is never pluralized',
  () => {
    const run = (severity: 'warning' | 'info', count: number) => {
      const { calls } = captureLogger(() =>
        reportValidation({
          diagnostics: Array.from({ length: count }, () => diagnostic()),
          skipped: [],
          entries: Array.from({ length: count }, (_, i) => ({ severity, text: `X${i}` })),
          blocking: false,
        })
      )
      return String(calls[0][0]).split('\n')[0]
    }
    assertEquals(run('warning', 1), 'Document validation: 1 warning')
    assertEquals(run('warning', 3), 'Document validation: 3 warnings')
    assertEquals(run('info', 2), 'Document validation: 2 info')
  },
)

Deno.test(
  'reportValidation: grouping DROPS NOTHING — every entry handed in is printed exactly once. This ' +
    'is the real risk of filtering inside a presenter, and the reason `.filter(` is allowed here ' +
    'only alongside this guarantee',
  () => {
    const entries = [
      { severity: 'error' as const, text: 'E1' },
      { severity: 'warning' as const, text: 'W1' },
      { severity: 'info' as const, text: 'I1' },
      { severity: 'warning' as const, text: 'W2' },
      { severity: 'error' as const, text: 'E2' },
    ]
    const { calls } = captureLogger(() =>
      reportValidation({
        diagnostics: entries.map(() => diagnostic()),
        skipped: [],
        entries,
        blocking: true,
      })
    )
    const printed = calls.map((args) => String(args[0])).join('\n')
    for (const entry of entries) {
      const occurrences = printed.split(entry.text).length - 1
      assertEquals(occurrences, 1, `${entry.text} printed ${occurrences} time(s)`)
    }
  },
)
