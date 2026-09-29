import { globToRegExp } from '@std/path'
import { OBFUSCATOR_SPECIFIER } from 'modules/lazy/specifiers.ts'

/**
 * Filters candidate `.js` file paths (relative to the build's `outDir`, e.g.
 * `assets/mouseTarget-<hash>.js` or `sw.js`, the form {@linkcode createObfuscationPlugin} and
 * `zanix build`'s single-file path use) against `--obfuscate-exclude`'s comma-separated glob list,
 * and returns the paths that should still be obfuscated.
 *
 * The opt-out exists because `javascript-obfuscator`'s identifier renaming can break third-party
 * code it was not written to survive. A vendor library's self-referencing `static {}` singleton
 * (`class C { static getInstance() { return C._INSTANCE ||= new C() } }`) has its `getInstance`
 * self-reference renamed to a generated hex identifier that is declared nowhere in the output,
 * throwing `TypeError: _0x... is not a constructor` on first use, in production, with no
 * build-time warning. Obfuscating vendor/`node_modules`-derived code has no product upside (it is
 * not proprietary source), and no obfuscator option (`reservedNames` included) closes this class of
 * bug, because the identifier that breaks is a freshly generated name with no fixed spelling to
 * reserve.
 *
 * Nothing is skipped by default (e.g. "every chunk not under `src/`"). The only available signal is
 * a chunk's output filename, and Vite/Rollup's default chunk naming does not distinguish vendor from
 * project code: it derives the name from the originating module's containing folder, so a
 * first-party comet at `comets/counter.tsx` builds to `comets-counter-<hash>.js`, the same shape a
 * `node_modules` chunk gets. Guessing would leave first-party chunks unobfuscated without warning,
 * whereas the obfuscate-everything default fails loudly and an explicit exclude list has neither
 * failure mode.
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
 * A fast, non-cryptographic string hash (djb2/xor variant) that turns a build's pre-obfuscation
 * code into a small, deterministic `seed` for `javascript-obfuscator` (see `buildObfuscatorOptions`).
 * The full `code` string is not used as `seed` because `javascript-obfuscator@4.2.2` converts a seed
 * to PRNG state pathologically slowly (a ~200KB seed takes over 30 seconds, a short one under a
 * second). A collision only makes two different chunks share a PRNG seed; each is still obfuscated
 * correctly, so a 32-bit rolling hash suffices.
 */
function hashCode(code: string): number {
  let hash = 5381
  for (let index = 0; index < code.length; index++) {
    hash = (hash * 33) ^ code.charCodeAt(index)
  }
  return hash >>> 0
}

/**
 * The `javascript-obfuscator` options {@linkcode obfuscateFile} and
 * {@linkcode createObfuscationPlugin} share, so both build pipelines (esbuild's single-file
 * `zanix build`, Vite's multi-chunk `zanix space build`) obfuscate identically.
 *
 * `seed` is derived from the pre-obfuscation `code` (via {@linkcode hashCode}) instead of
 * `javascript-obfuscator`'s `Math.random()`-backed default, so the same source built twice with the
 * same obfuscator version and options yields byte-identical output. The plugin's chunk content hash
 * is computed from this output, so a random seed would change the hash, and bust every client's
 * cache, on every rebuild.
 */
function buildObfuscatorOptions(code: string) {
  return {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    seed: hashCode(code),
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
  } as const
}

/**
 * Runs `javascript-obfuscator` over a single string of already-built JS — the one place that
 * actually calls it, shared by {@linkcode obfuscateFile} (reads/writes a file itself) and
 * {@linkcode createObfuscationPlugin} (obfuscates in-memory chunk/asset content mid-build).
 * `OBFUSCATOR_SPECIFIER` is imported lazily HERE, not at module top level, so no `zanix build`/
 * `zanix space build` invocation pays for resolving `javascript-obfuscator` unless `--obfuscate`
 * is actually passed — same lazy-dependency convention this repo already follows elsewhere.
 */
async function obfuscateCode(code: string): Promise<string> {
  const { default: obfuscator } = await import(OBFUSCATOR_SPECIFIER)
  return obfuscator.obfuscate(code, buildObfuscatorOptions(code)).getObfuscatedCode()
}

/**
 * Obfuscates a single file's already-built JS content in place. Used only by `zanix build`'s
 * single-file esbuild path (`build-runner.ts`'s `mainBuilderFunction`), whose `outputFile` is a
 * fixed, author-chosen path with no content hash, so rewriting it after the build invalidates no
 * hash.
 *
 * `zanix space build` obfuscates as a build transform instead; see
 * {@linkcode createObfuscationPlugin} for why.
 *
 * @param filePath - Path to an already-built `.js` file, read and overwritten in place.
 */
export async function obfuscateFile(filePath: string): Promise<void> {
  const content = await Deno.readTextFile(filePath)
  await Deno.writeTextFile(filePath, await obfuscateCode(content))
}

/** The minimal structural shape Vite/Rollup actually need from a plugin object for `renderChunk`/
 * `generateBundle` hooks — not the real `vite` package's own `Plugin` type, deliberately: `cli`'s
 * own `deno.jsonc` has no direct `vite` dependency declared (only `@zanix/space` does,
 * transitively) — same reasoning as `fix-npm-slash-specifier.ts`'s own `TransformOnlyVitePlugin`.
 * `@zanix/space/vite`'s `buildSpaceClient({ plugins })` accepts any object matching Vite's real
 * `Plugin` shape, this structural subset included. */
interface ObfuscationVitePlugin {
  name: string
  apply: 'build'
  renderChunk(
    code: string,
    chunk: { fileName: string },
  ): Promise<{ code: string; map: null } | null>
  generateBundle(
    options: unknown,
    bundle: Record<string, { type: string; fileName: string; source?: string | Uint8Array }>,
  ): Promise<void>
}

/**
 * Returns a Vite/Rollup build plugin that obfuscates `zanix space build`'s output: comet/CSS/
 * client-entry chunks via `renderChunk`, and the generated `sw.js` service worker via
 * `generateBundle`.
 *
 * Obfuscation runs inside the build, never as a rewrite of already-written files. Vite/Rollup name
 * every hashed output file (`assets/<name>-<hash>.js`) from the chunk's content, and `@zanix/space`'s
 * `AssetsRoute` serves each one with `Cache-Control: public, max-age=31536000, immutable`. Bytes
 * obfuscated after the hash is minted would let two builds that differ (another
 * `--obfuscate-exclude`, another `javascript-obfuscator` version) serve different bytes under the
 * same immutable URL, and a browser that cached the old bytes would never refetch them.
 *
 * `renderChunk` runs before Rollup/Vite substitute the `[hash]` placeholder in a chunk's filename,
 * so a chunk whose code the hook changes gets a hash computed from the bytes actually served. That
 * keeps the `AssetsRoute` caching invariant true for every build, whatever the obfuscation config.
 *
 * `sw.js` needs a separate `generateBundle` hook: `pwaPlugin` emits it as a plain Rollup `asset`
 * (`this.emitFile({ type: 'asset', fileName: 'sw.js', ... })`), and `renderChunk` only sees chunks.
 * Its filename carries no hash (a service worker's URL must stay stable for the browser to re-check
 * it), so obfuscating it here keeps the whole pass inside the pipeline rather than protecting
 * against the cache hazard above. The plugin is appended after `pwaPlugin` in `buildSpaceClient`'s
 * plugins array (`action.ts`'s `plugins: [...]`) and Rollup runs same-hook plugins in array order,
 * so `sw.js` already exists in `bundle` when this `generateBundle` runs.
 *
 * @param exclude - `--obfuscate-exclude`'s raw value, forwarded to
 * {@linkcode excludeObfuscationTargets} unchanged.
 */
export function createObfuscationPlugin(exclude?: string): ObfuscationVitePlugin {
  return {
    name: 'zanix-space-obfuscate',
    apply: 'build',
    async renderChunk(code, chunk) {
      if (excludeObfuscationTargets([chunk.fileName], exclude).length === 0) return null
      return { code: await obfuscateCode(code), map: null }
    },
    async generateBundle(_options, bundle) {
      const targets = Object.values(bundle).filter(
        (asset): asset is typeof asset & { source: string } =>
          asset.type === 'asset' &&
          asset.fileName.endsWith('.js') &&
          typeof asset.source === 'string' &&
          excludeObfuscationTargets([asset.fileName], exclude).length > 0,
      )
      await Promise.all(targets.map(async (asset) => {
        asset.source = await obfuscateCode(asset.source)
      }))
    },
  }
}
