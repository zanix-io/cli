import { analyzeSource } from 'commands/check-cycles/lib/side-effects/analyze-file.ts'
import type { FileAnalysis } from 'commands/check-cycles/lib/side-effects/types.ts'

const FILES_ENV = 'ZNX_CHECK_CYCLES_FILES'
const OUTPUT_ENV = 'ZNX_CHECK_CYCLES_OUTPUT'

/**
 * The real AST-analysis engine, run as its own `deno test` subprocess — `analyze.ts` spawns this
 * file directly (`deno test -A --no-check <this file>`) because `Deno.lint.runPlugin` (the only
 * fully Deno-native way to get a real AST, no third-party parser dependency) only works inside a
 * `deno test` process, confirmed empirically: calling it from a plain `deno run` script throws
 * `Deno.lint.runPlugin is only available in 'deno test' subcommand`.
 *
 * Reads the file list from `ZNX_CHECK_CYCLES_FILES` (a JSON array of absolute paths, set by the
 * parent process — an env var, not an argument, since this file is invoked as a `deno test`
 * target, not a plain script with its own argv) and writes the real results to
 * `ZNX_CHECK_CYCLES_OUTPUT` as JSON — never to stdout, which `deno test`'s own runner formatting
 * shares and would corrupt.
 */
Deno.test('check-cycles: analyze top-level side effects', async () => {
  const filesJson = Deno.env.get(FILES_ENV)
  const outputPath = Deno.env.get(OUTPUT_ENV)

  if (!filesJson || !outputPath) {
    throw new Error(
      `Missing '${FILES_ENV}'/'${OUTPUT_ENV}' env vars — this file is meant to be run via ` +
        `'analyze.ts', not directly.`,
    )
  }

  const files = JSON.parse(filesJson) as string[]
  const results: FileAnalysis[] = []

  for (const file of files) {
    // deno-lint-ignore no-await-in-loop
    const source = await Deno.readTextFile(file)
    results.push(analyzeSource(file, source))
  }

  await Deno.writeTextFile(outputPath, JSON.stringify(results))
})
