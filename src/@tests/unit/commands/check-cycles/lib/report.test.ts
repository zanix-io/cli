import { assertEquals } from '@std/assert'
import { findCycles } from 'commands/check-cycles/lib/cycles.ts'
import { formatReport } from 'commands/check-cycles/lib/report.ts'
import type { Finding } from 'commands/check-cycles/lib/analyze.ts'
import type { ImportGraph } from 'commands/check-cycles/lib/graph.ts'

// Regression test for the real bug: `formatReport` used to print `finding.cycle` — Tarjan's own
// SCC pop-order (`findCycles`, `cycles.ts`) — directly with `->` between consecutive members,
// which visually implies a real edge-by-edge import path that was never confirmed to exist.
//
// This fixture is a real 4-file cycle, built so Tarjan's pop-order is DEMONSTRABLY different from
// any real import path — confirmed empirically by running `findCycles` against it (not asserted
// by construction alone): `a.ts` imports `b.ts` AND `c.ts`; both `b.ts` and `c.ts` import `d.ts`;
// `d.ts` imports back to `a.ts`, closing the cycle. `findCycles` pops this SCC in the order
// `[c.ts, d.ts, b.ts, a.ts]` — printed raw (the pre-fix behavior), that reads
// `c.ts -> d.ts -> b.ts -> a.ts -> c.ts`, but neither `d.ts -> b.ts` nor `b.ts -> a.ts` is a real
// import: `d.ts` only imports `a.ts`, and `b.ts` only imports `d.ts`.
const root = '/repo'
const a = '/repo/a.ts'
const b = '/repo/b.ts'
const c = '/repo/c.ts'
const d = '/repo/d.ts'

function buildGraph(): ImportGraph {
  const graph: ImportGraph = new Map()
  graph.set(a, new Set([b, c]))
  graph.set(b, new Set([d]))
  graph.set(c, new Set([d]))
  graph.set(d, new Set([a]))
  return graph
}

Deno.test(
  'formatReport prints the real edge-by-edge import path, not the raw Tarjan pop-order',
  () => {
    const graph = buildGraph()
    const cycles = findCycles(graph)

    assertEquals(cycles.length, 1)
    // Locks in the empirically-confirmed Tarjan pop-order this fixture produces — if this
    // assertion ever breaks, the fixture no longer demonstrates the divergence this test exists
    // to catch, and needs to be rebuilt against whatever order Tarjan produces instead.
    assertEquals(cycles[0], [c, d, b, a])

    // `d.ts` has a top-level statement reading an identifier really imported from `a.ts` — a real
    // edge (`d.ts -> a.ts`), same shape as the real `@zanix/notifications` SMTP finding.
    const finding: Finding = {
      file: d,
      line: 3,
      identifier: 'thing',
      sourceFile: a,
      cycle: cycles[0],
    }

    const report = formatReport(root, graph, cycles, [finding])

    // Real path: d.ts -> a.ts (direct edge, closing the read) -> b.ts -> d.ts (real edges only,
    // closing the loop back to the reading file). Never `d.ts -> b.ts` or `b.ts -> a.ts` — the
    // raw Tarjan order's fake adjacencies.
    assertEquals(
      report,
      `d.ts:3 — top-level statement reads 'thing' from 'a.ts', still inside the same import ` +
        `cycle: d.ts -> a.ts -> b.ts -> d.ts`,
    )
  },
)

Deno.test('formatReport reports clean when there are no findings, cycle or not', () => {
  const graph = buildGraph()
  const cycles = findCycles(graph)

  const report = formatReport(root, graph, cycles, [])

  assertEquals(
    report,
    'current (1 intra-package import cycle found, none pair a top-level side effect with a ' +
      'cross-cycle binding read)',
  )
})
