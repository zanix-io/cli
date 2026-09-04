import { fromFileUrl } from '@std/path'
import type { Cycle } from 'commands/check-cycles/lib/cycles.ts'
import type { SpecifierResolutions } from 'commands/check-cycles/lib/graph.ts'
import type { FileAnalysis } from 'commands/check-cycles/lib/side-effects/types.ts'

/** A confirmed hit: a top-level statement in `file` (part of `cycle`) reads `identifier`, which
 * `file` imports from `sourceFile` — also still part of the same `cycle`. Mirrors this
 * ecosystem's own real precedent (`@zanix/notifications`'s `defs.ts`'s `registerSmtpConnector()`
 * reading `SmtpClient` from `connector.ts`, both in the same cycle). */
export type Finding = {
  file: string
  line: number
  identifier: string
  sourceFile: string
  cycle: Cycle
}

/**
 * Runs the AST-analysis harness (a real `deno test` subprocess — see `harness.test.ts`'s own doc
 * for why) against every file inside any detected cycle, then cross-references each risky
 * top-level statement's referenced identifiers against that file's own imports: a hit only counts
 * when the imported identifier's SOURCE FILE is also a member of the same cycle — an import from
 * outside the cycle is never risky here, however eager the statement itself looks.
 *
 * Resolves each import's raw specifier via `specifierResolutions` (built from `deno info`'s own
 * already-correct resolution — see `graph.ts`'s own doc) rather than re-deriving it from a
 * `./`/`../`-only heuristic, which would silently miss every alias-style import this ecosystem
 * also uses (`'modules/logger/main.ts'`, not `'./main.ts'` — confirmed real in `@zanix/utils`).
 */
export async function findConfirmedFindings(
  cycles: Cycle[],
  specifierResolutions: SpecifierResolutions,
): Promise<Finding[]> {
  const filesInCycles = [...new Set(cycles.flat())]
  if (filesInCycles.length === 0) return []

  const analyses = await runHarness(filesInCycles)
  const analysisByFile = new Map(analyses.map((a) => [a.file, a]))
  const cycleByFile = new Map<string, Cycle>()
  for (const cycle of cycles) {
    for (const file of cycle) cycleByFile.set(file, cycle)
  }

  const findings: Finding[] = []

  for (const file of filesInCycles) {
    const analysis = analysisByFile.get(file)
    const cycle = cycleByFile.get(file)
    const resolutions = specifierResolutions.get(file)
    if (!analysis || !cycle || !resolutions) continue

    const cycleMembers = new Set(cycle)

    for (const statement of analysis.riskyStatements) {
      for (const identifier of statement.identifiers) {
        const specifier = analysis.imports[identifier]
        const sourceFile = specifier ? resolutions.get(specifier) : undefined
        if (sourceFile && cycleMembers.has(sourceFile)) {
          findings.push({ file, line: statement.line, identifier, sourceFile, cycle })
        }
      }
    }
  }

  return findings
}

async function runHarness(files: string[]): Promise<FileAnalysis[]> {
  const outputPath = await Deno.makeTempFile({ prefix: 'znx-check-cycles-', suffix: '.json' })

  // Computed HERE, not at module top-level — `import.meta.url` is only ever a real `file://` URL
  // when this module itself was loaded from local disk (running `zanix` from a real checkout).
  // Once this module loads from a REMOTE specifier instead (`https://jsr.io/...` — exactly what
  // happens for a globally-installed CLI, `deno install -g jsr:@zanix/cli`), `fromFileUrl` throws
  // outright — and since this WAS at module top-level, that throw happened on every single CLI
  // invocation, not just `check-cycles`, breaking even `--version`/`--help`. Moved into this
  // function so it only ever runs when `check-cycles` genuinely executes.
  const harnessPath = fromFileUrl(
    new URL('./side-effects/harness.test.ts', import.meta.url),
  )

  try {
    const command = new Deno.Command(Deno.execPath(), {
      args: ['test', '-A', '--no-check', harnessPath],
      env: {
        ZNX_CHECK_CYCLES_FILES: JSON.stringify(files),
        ZNX_CHECK_CYCLES_OUTPUT: outputPath,
      },
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, stderr } = await command.output()
    if (!success) {
      throw new Error(
        `The side-effect analysis harness failed: ${new TextDecoder().decode(stderr)}`,
      )
    }

    const raw = await Deno.readTextFile(outputPath)
    return JSON.parse(raw) as FileAnalysis[]
  } finally {
    await Deno.remove(outputPath).catch(() => {})
  }
}
