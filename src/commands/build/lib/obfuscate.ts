import { globToRegExp } from '@std/path'
import { OBFUSCATOR_SPECIFIER } from 'modules/lazy/specifiers.ts'

/**
 * Filters a list of candidate `.js` file paths (relative to the build's own `outDir` — e.g.
 * `assets/mouseTarget-<hash>.js`, `sw.js`, the same relative form `zanix space build`'s own
 * `jsFiles` collection already uses) against `--obfuscate-exclude`'s comma-separated glob list,
 * returning only the paths that should still be obfuscated.
 *
 * This exists because `javascript-obfuscator`'s identifier renaming can genuinely mismatch
 * third-party code it was never written to survive — a reported, reproduced case: a vendor
 * library's self-referencing `static {}` singleton pattern (`class C { static getInstance() {
 * return C._INSTANCE ||= new C() } }`) gets its `getInstance` self-reference renamed to a
 * generated hex identifier that isn't declared anywhere in the renamed output, throwing
 * `TypeError: _0x... is not a constructor` the first time the singleton is used — silently, in
 * production, with no build-time warning. Obfuscating vendor/`node_modules`-derived code has no
 * real product upside to begin with (it isn't proprietary source), so the fix here is an explicit
 * opt-out, not a smarter obfuscator config: no `javascript-obfuscator` option (`reservedNames`
 * included) can close this class of bug in general, since the identifier that breaks is a FRESH
 * generated name with no fixed spelling to reserve in advance, and the next vendor library to hit
 * a different obfuscator edge case would just generate a different one.
 *
 * Deliberately does NOT default to skipping anything itself (e.g. "every chunk not under `src/`")
 * — that was considered and rejected: the only signal available post-build is each chunk's own
 * OUTPUT filename, and Vite/Rollup's default chunk-naming isn't a "vendor vs. project source"
 * signal at all, just a function of the originating module's own containing folder (confirmed
 * directly against this repo's own build fixture: a comet at `comets/counter.tsx` — genuine
 * first-party code — builds to `comets-counter-<hash>.js`, prefixed with its own folder name, the
 * exact same shape a `node_modules`-derived chunk gets prefixed with its own package/folder name).
 * Guessing "vendor" from that would silently leave real first-party chunks unobfuscated with no
 * warning — worse than today's "obfuscates everything" default, which at least fails loudly (a
 * crash) rather than quietly (a no-op that looks like it worked). An explicit, human-reviewed
 * exclude list has no such failure mode.
 *
 * @param paths - Candidate `.js` file paths, relative to `outDir`.
 * @param excludeGlobs - The raw `--obfuscate-exclude` value: zero or more comma-separated glob
 * patterns (e.g. `'assets/monaco*.js,assets/mouseTarget*.js'`). Absent/empty is a no-op — every
 * path passes through.
 */
export function excludeObfuscationTargets(paths: string[], excludeGlobs?: string): string[] {
  const patterns = (excludeGlobs ?? '')
    .split(',')
    .map((glob) => glob.trim())
    .filter(Boolean)
  if (patterns.length === 0) return paths

  const regexes = patterns.map((glob) => globToRegExp(glob, { extended: true, globstar: true }))
  return paths.filter((path) => !regexes.some((regex) => regex.test(path)))
}

/**
 * Obfuscates a single file's own already-built JS content in place — the exact
 * `javascript-obfuscator` options `mainBuilderFunction` (`build-runner.ts`) already used, factored
 * out so `zanix build`'s original single-file esbuild path and `zanix space build`'s own
 * multi-file Vite client build (one real output file per comet/stylesheet, not one) can share the
 * identical obfuscation behavior instead of drifting into two independently-tuned configs.
 *
 * @param filePath - Path to an already-built `.js` file, read and overwritten in place.
 */
export async function obfuscateFile(filePath: string): Promise<void> {
  const content = await Deno.readTextFile(filePath)
  const { default: obfuscator } = await import(OBFUSCATOR_SPECIFIER)

  const obfuscated = obfuscator.obfuscate(content, {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    stringArray: true,
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'variable',
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode()

  await Deno.writeTextFile(filePath, obfuscated)
}
