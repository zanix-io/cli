import { resolve } from '@std/path'
import { Commander } from 'cli'
import { resolveRealEntrypoints } from 'commands/check-cycles/lib/entrypoints.ts'
import { buildIntraRepoGraph } from 'commands/check-cycles/lib/graph.ts'
import { findCycles } from 'commands/check-cycles/lib/cycles.ts'
import { findConfirmedFindings } from 'commands/check-cycles/lib/analyze.ts'
import { formatReport } from 'commands/check-cycles/lib/report.ts'
import logger from '@zanix/logger'

/**
 * `zanix check-cycles` — the automated check for intra-package circular imports with a top-level
 * side effect: a real, shipped bug class in this ecosystem (`@zanix/notifications`'s SMTP
 * connector — `defs.ts`'s eager `registerSmtpConnector()` reading `SmtpClient` mid-cycle from
 * `connector.ts`/`pool.ts`, a real `ReferenceError: Cannot access 'SmtpClient' before
 * initialization`), not a hypothetical.
 *
 * A bare `Commander` instance (not registered via `baseArgumentActionCommand`), same shape as
 * `build`'s own single-leaf command — this command has no sub-leaves of its own and never calls
 * `this.runCommand(...)`.
 *
 * Two independent phases, each covering a real, distinct failure mode: (1) `deno info --json`
 * resolves the repo's REAL intra-package import graph (relative AND import-map/alias imports
 * alike, restricted to files resolving under the checked repo's own root — a cross-package
 * `@zanix/*` cycle is a separate, cross-package concern, not this command's) and finds real
 * cycles via Tarjan's SCC; (2) only for files actually inside a cycle, a real AST pass (via
 * `Deno.lint.runPlugin`, run as its own `deno test` subprocess — see `harness.test.ts`'s own doc
 * for why) finds a top-level statement that executes something AND reads a binding still inside
 * that same cycle. A bare cycle with no such statement is reported as clean, not as a finding —
 * most cycles in this ecosystem are harmless, and flagging every one would be pure noise.
 */
export default function checkCyclesCommand(this: Commander) {
  const cwd = new Commander()

  this.mountGroup('check-cycles', cwd)
    .description(
      'Checks for a real intra-package circular import combined with a top-level side effect ' +
        'that reads a binding still inside that same cycle — the shape that caused a real, ' +
        "shipped crash in @zanix/notifications's SMTP connector. Exits non-zero on a confirmed " +
        'finding, so this is safe to gate a CI job on.',
    )
    .option(
      '-p --path <path:string>',
      'The Zanix package root to check (must have its own deno.json/deno.jsonc). Defaults to ' +
        'the current working directory.',
      { default: '.' },
    )
    .action(async (options) => {
      const root = resolve((options as { path: string }).path)

      let entrypoints: string[]
      try {
        entrypoints = await resolveRealEntrypoints(root)
      } catch (error) {
        cwd.throw(error instanceof Error ? error : new Error(String(error)))
        return
      }

      if (entrypoints.length === 0) {
        logger.warn(`No 'exports' entrypoints found under '${root}' — nothing to check.`)
        return
      }

      const { graph, specifierResolutions } = await buildIntraRepoGraph(root, entrypoints)
      const cycles = findCycles(graph)
      const findings = await findConfirmedFindings(cycles, specifierResolutions)

      const report = formatReport(root, graph, cycles, findings)

      if (findings.length > 0) {
        cwd.throw(new Error(`Confirmed intra-package circular-import hazard:\n${report}`))
        return
      }

      logger.info(`${root}: ${report}`)
    })
}
