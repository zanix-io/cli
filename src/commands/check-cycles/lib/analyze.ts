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
 * Runs the AST-analysis harness (a real `deno test` subprocess — see `runHarness`'s own doc for
 * why) against every file inside any detected cycle, then cross-references each risky top-level
 * statement's referenced identifiers against that file's own imports: a hit only counts when the
 * imported identifier's SOURCE FILE is also a member of the same cycle — an import from outside
 * the cycle is never risky here, however eager the statement itself looks.
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

/**
 * The generated harness's own source — a single top-level `Deno.test` that reads the file list
 * from `ZNX_CHECK_CYCLES_FILES`, runs `analyzeSource` (only importable inside a real `deno test`
 * process — `Deno.lint.runPlugin` throws `'Deno.lint.runPlugin' is only available in 'deno test'
 * subcommand` from a plain `deno run` script) over each, and writes the results to
 * `ZNX_CHECK_CYCLES_OUTPUT` as JSON — never to stdout, which `deno test`'s own runner formatting
 * shares and would corrupt. `analyzeFileSpecifier` is substituted in as a JSON-encoded string
 * literal, never string-concatenated raw, so a Windows drive-letter path or any other character
 * needing escaping round-trips correctly.
 */
export function buildHarnessSource(analyzeFileSpecifier: string): string {
  return `import { analyzeSource } from ${JSON.stringify(analyzeFileSpecifier)}

Deno.test('check-cycles: analyze top-level side effects', async () => {
  const files = JSON.parse(Deno.env.get('ZNX_CHECK_CYCLES_FILES')!) as string[]
  const results = []
  for (const file of files) {
    const source = await Deno.readTextFile(file)
    results.push(analyzeSource(file, source))
  }
  await Deno.writeTextFile(Deno.env.get('ZNX_CHECK_CYCLES_OUTPUT')!, JSON.stringify(results))
})
`
}

/**
 * Spawns a real `deno test` subprocess to run `analyzeSource` over `files` — a real subprocess,
 * not an in-process call, because `Deno.lint.runPlugin` (the only fully Deno-native way to get a
 * real AST, no third-party parser dependency) only works inside a `deno test` process.
 *
 * The subprocess target is a fresh, real LOCAL `.test.ts` file generated here on every run —
 * deliberately never `fromFileUrl(new URL('./side-effects/analyze-file.ts', import.meta.url))`
 * (a real, confirmed-via-repro bug this replaced): `import.meta.url` is only ever a real `file://`
 * URL when THIS module itself loads from local disk. Once `@zanix/cli` loads from a REMOTE
 * specifier instead — `https://jsr.io/...`, exactly what happens for `deno run -A
 * jsr:@zanix/cli check-cycles` (this command's own documented, CI-recommended invocation) or a
 * global install (`deno install -g jsr:@zanix/cli`) — `fromFileUrl` throws `TypeError: Must be a
 * file URL` outright, confirmed real against `@zanix/asyncmq`/`@zanix/datamaster`, both of which
 * have a real (harmless) intra-package cycle that reaches this code path.
 *
 * `import.meta.resolve`, used instead, returns a valid absolute specifier string regardless of
 * protocol — a `file://` URL for a local checkout, an `https://jsr.io/...` URL for a remote
 * install — and never throws on a non-file URL. Writing that specifier into a genuinely local temp
 * file's own import statement means `deno test` always has a real local path to target (`deno test`
 * itself can't take a remote URL as a test-discovery target — confirmed via repro: it reports 'No
 * test modules found'), while the import INSIDE that file resolves `analyze-file.ts` exactly like
 * any other module specifier, local or remote alike.
 */
async function runHarness(files: string[]): Promise<FileAnalysis[]> {
  const outputPath = await Deno.makeTempFile({ prefix: 'znx-check-cycles-', suffix: '.json' })
  const harnessPath = await Deno.makeTempFile({
    prefix: 'znx-check-cycles-harness-',
    suffix: '.test.ts',
  })

  try {
    const analyzeFileSpecifier = import.meta.resolve('./side-effects/analyze-file.ts')
    await Deno.writeTextFile(harnessPath, buildHarnessSource(analyzeFileSpecifier))

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
    await Deno.remove(harnessPath).catch(() => {})
  }
}
