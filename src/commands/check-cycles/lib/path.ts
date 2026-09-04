import type { ImportGraph } from 'commands/check-cycles/lib/graph.ts'

/**
 * Finds the real, shortest import path from `from` to `to`, following actual edges of `graph`
 * and restricted to `allowedNodes` (typically a cycle's own membership set — restricting the
 * search this way keeps the result inside the cycle being reported instead of wandering through
 * a real but irrelevant import that happens to lead outside it).
 *
 * A plain BFS, not anything more sophisticated — every edge in `graph` is unweighted, so the
 * first path BFS finds is already shortest. `from === to` is trivially satisfied by a one-element
 * path with no traversal, matching how `report.ts` uses this twice per finding (`file` ->
 * `sourceFile`, then `sourceFile` -> `file` to close the loop) without forcing a self-edge lookup
 * when both happen to already be the same node.
 *
 * This exists specifically because `findCycles`'s own `Cycle` array (`cycles.ts`) is Tarjan's
 * pop-order at SCC closure — real cycle MEMBERSHIP, not a real edge-by-edge path — and printing
 * it directly with `->` between consecutive members (the bug this function fixes) visually implies
 * adjacency that was never confirmed: two consecutive members of a `Cycle` array are not
 * guaranteed to have a direct import edge between them.
 *
 * @throws if no path exists between `from` and `to` within `allowedNodes`. Two nodes confirmed to
 * be members of the same strongly connected component are always mutually reachable through that
 * component's own edges, so this should never happen in practice for a real `Finding`'s `cycle`
 * set — surfacing it loudly instead of silently returning an incomplete/misleading path is
 * deliberate, matching this same fix's own reason for existing.
 */
export function findRealPath(
  graph: ImportGraph,
  allowedNodes: ReadonlySet<string>,
  from: string,
  to: string,
): string[] {
  if (from === to) return [from]

  const visited = new Set<string>([from])
  const previous = new Map<string, string>()
  const queue: string[] = [from]

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]

    for (const neighbor of graph.get(current) ?? []) {
      if (!allowedNodes.has(neighbor) || visited.has(neighbor)) continue

      visited.add(neighbor)
      previous.set(neighbor, current)

      if (neighbor === to) return reconstructPath(previous, from, to)

      queue.push(neighbor)
    }
  }

  throw new Error(
    `No real import path found from '${from}' to '${to}' restricted to the given cycle ` +
      `members — two nodes in the same strongly connected component are always mutually ` +
      `reachable through that component's own edges, so this means the 'allowedNodes' set ` +
      `passed in doesn't actually match the cycle these two nodes belong to.`,
  )
}

function reconstructPath(previous: Map<string, string>, from: string, to: string): string[] {
  const path: string[] = [to]
  let node = to

  while (node !== from) {
    // deno-lint-ignore no-non-null-assertion
    node = previous.get(node)!
    path.unshift(node)
  }

  return path
}
