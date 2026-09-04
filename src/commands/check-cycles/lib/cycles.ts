import type { ImportGraph } from 'commands/check-cycles/lib/graph.ts'

/** A real cycle: every file in it can reach every other file in it (a strongly connected
 * component of size > 1, or a single file that imports itself). */
export type Cycle = string[]

/**
 * Finds every real cycle in an intra-repo import graph via Tarjan's strongly-connected-components
 * algorithm — a single pass, no repeated per-node reachability checks.
 *
 * A strongly connected component of size 1 is only a real cycle when that single file imports
 * itself (a genuine, if unusual, self-loop) — everything else with no outgoing edge back into
 * itself is just an ordinary acyclic node and never reported.
 */
export function findCycles(graph: ImportGraph): Cycle[] {
  let counter = 0
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: Cycle[] = []

  const strongConnect = (node: string) => {
    indices.set(node, counter)
    lowlink.set(node, counter)
    counter++
    stack.push(node)
    onStack.add(node)

    for (const neighbor of graph.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor)
        lowlink.set(node, Math.min(lowlink.get(node) as number, lowlink.get(neighbor) as number))
      } else if (onStack.has(neighbor)) {
        lowlink.set(node, Math.min(lowlink.get(node) as number, indices.get(neighbor) as number))
      }
    }

    if (lowlink.get(node) === indices.get(node)) {
      const component: string[] = []
      let member: string
      do {
        // deno-lint-ignore no-non-null-assertion
        member = stack.pop()!
        onStack.delete(member)
        component.push(member)
      } while (member !== node)

      const isRealCycle = component.length > 1 ||
        (graph.get(component[0])?.has(component[0]) ?? false)
      if (isRealCycle) cycles.push(component)
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) strongConnect(node)
  }

  return cycles
}
