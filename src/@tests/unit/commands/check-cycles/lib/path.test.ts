import { assertEquals, assertThrows } from '@std/assert'
import { findRealPath } from 'commands/check-cycles/lib/path.ts'
import type { ImportGraph } from 'commands/check-cycles/lib/graph.ts'

// `findRealPath` is the fix for `report.ts`'s real bug: `findCycles` (`cycles.ts`) returns a
// `Cycle` array in Tarjan's own pop-order at SCC closure — real cycle MEMBERSHIP, not a real
// edge-by-edge path — so printing it directly with `->` between consecutive members visually
// implies an adjacency that was never confirmed. These tests cover the BFS in isolation; the
// concrete before/after divergence against a real 4-file cycle lives in `report.test.ts`.

Deno.test('findRealPath returns the trivial one-node path when from === to', () => {
  const graph: ImportGraph = new Map([['/repo/a.ts', new Set(['/repo/b.ts'])]])

  assertEquals(findRealPath(graph, new Set(['/repo/a.ts']), '/repo/a.ts', '/repo/a.ts'), [
    '/repo/a.ts',
  ])
})

Deno.test('findRealPath returns a direct one-edge path when a direct edge exists', () => {
  const graph: ImportGraph = new Map([
    ['/repo/a.ts', new Set(['/repo/b.ts'])],
    ['/repo/b.ts', new Set(['/repo/a.ts'])],
  ])
  const allowed = new Set(['/repo/a.ts', '/repo/b.ts'])

  assertEquals(findRealPath(graph, allowed, '/repo/a.ts', '/repo/b.ts'), [
    '/repo/a.ts',
    '/repo/b.ts',
  ])
})

Deno.test(
  'findRealPath skips a shorter real path through a node outside allowedNodes',
  () => {
    // A -> X -> B is the real shortest path in the FULL graph, but X is not a cycle member here —
    // the only path restricted to {A, C, D, B} is the longer A -> C -> D -> B.
    const graph: ImportGraph = new Map([
      ['/repo/a.ts', new Set(['/repo/x.ts', '/repo/c.ts'])],
      ['/repo/x.ts', new Set(['/repo/b.ts'])],
      ['/repo/c.ts', new Set(['/repo/d.ts'])],
      ['/repo/d.ts', new Set(['/repo/b.ts'])],
      ['/repo/b.ts', new Set()],
    ])
    const allowed = new Set(['/repo/a.ts', '/repo/c.ts', '/repo/d.ts', '/repo/b.ts'])

    assertEquals(findRealPath(graph, allowed, '/repo/a.ts', '/repo/b.ts'), [
      '/repo/a.ts',
      '/repo/c.ts',
      '/repo/d.ts',
      '/repo/b.ts',
    ])
  },
)

Deno.test('findRealPath resolves a diamond (two converging real paths) without error', () => {
  const graph: ImportGraph = new Map([
    ['/repo/a.ts', new Set(['/repo/b.ts', '/repo/c.ts'])],
    ['/repo/b.ts', new Set(['/repo/d.ts'])],
    ['/repo/c.ts', new Set(['/repo/d.ts'])],
    ['/repo/d.ts', new Set()],
  ])
  const allowed = new Set(['/repo/a.ts', '/repo/b.ts', '/repo/c.ts', '/repo/d.ts'])

  const path = findRealPath(graph, allowed, '/repo/a.ts', '/repo/d.ts')

  assertEquals(path.length, 3)
  assertEquals(path[0], '/repo/a.ts')
  assertEquals(path[2], '/repo/d.ts')
  assertEquals(['/repo/b.ts', '/repo/c.ts'].includes(path[1]), true)
})

Deno.test(
  'findRealPath throws a descriptive error when no path exists within allowedNodes',
  () => {
    const graph: ImportGraph = new Map([
      ['/repo/a.ts', new Set(['/repo/b.ts'])],
      ['/repo/b.ts', new Set()],
      ['/repo/c.ts', new Set()],
    ])

    assertThrows(
      () =>
        findRealPath(
          graph,
          new Set(['/repo/a.ts', '/repo/b.ts', '/repo/c.ts']),
          '/repo/a.ts',
          '/repo/c.ts',
        ),
      Error,
      "No real import path found from '/repo/a.ts' to '/repo/c.ts'",
    )
  },
)
