import { relative } from '@std/path'
import type { Cycle } from 'commands/check-cycles/lib/cycles.ts'
import type { Finding } from 'commands/check-cycles/lib/analyze.ts'
import type { ImportGraph } from 'commands/check-cycles/lib/graph.ts'
import { findRealPath } from 'commands/check-cycles/lib/path.ts'

/**
 * Formats a real report, human-readable and CI-log-friendly — the same shape whether a human runs
 * this command directly or an automated periodic run invokes it, so the finding reads identically
 * either way.
 *
 * The printed cycle path is a REAL edge-by-edge import path, not `finding.cycle` printed
 * directly — `finding.cycle` is Tarjan's own SCC pop-order (real cycle membership, not a real
 * traversed path; see `path.ts`'s own doc), so it's used here only to restrict `findRealPath`'s
 * search to the cycle's members, never printed as-is.
 */
export function formatReport(
  root: string,
  graph: ImportGraph,
  cycles: Cycle[],
  findings: Finding[],
): string {
  const rel = (file: string) => relative(root, file)

  if (findings.length === 0) {
    return `current (${cycles.length} intra-package import cycle${
      cycles.length === 1 ? '' : 's'
    } found, none pair a top-level side effect with a cross-cycle binding read)`
  }

  const lines = findings.map((finding) => {
    const allowedNodes = new Set(finding.cycle)
    const toSource = findRealPath(graph, allowedNodes, finding.file, finding.sourceFile)
    const backToFile = findRealPath(graph, allowedNodes, finding.sourceFile, finding.file)
    const cyclePath = [...toSource, ...backToFile.slice(1)].map(rel).join(' -> ')

    return `${
      rel(finding.file)
    }:${finding.line} — top-level statement reads '${finding.identifier}' ` +
      `from '${rel(finding.sourceFile)}', still inside the same import cycle: ${cyclePath}`
  })

  return lines.join('\n')
}
