import { globToRegExp } from '@std/path'
import { OBFUSCATOR_SPECIFIER } from 'modules/lazy/specifiers.ts'

/**
 * Filters a list of candidate `.js` file paths (relative to the build's own `outDir` — e.g.
 * `assets/mouseTarget-<hash>.js`, `sw.js`, the same relative form `zanix space build`'s own
 * {@linkcode createObfuscationPlugin} and `zanix build`'s single-file path already use) against
 * `--obfuscate-exclude`'s comma-separated glob list, returning only the paths that should still be
 * obfuscated.
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
 * — that was considered and rejected: the only signal available is each chunk's own OUTPUT
 * filename, and Vite/Rollup's default chunk-naming isn't a "vendor vs. project source" signal at
 * all, just a function of the originating module's own containing folder (confirmed directly
 * against this repo's own build fixture: a comet at `comets/counter.tsx` — genuine first-party
 * code — builds to `comets-counter-<hash>.js`, prefixed with its own folder name, the exact same
 * shape a `node_modules`-derived chunk gets prefixed with its own package/folder name). Guessing
 * "vendor" from that would silently leave real first-party chunks unobfuscated with no warning —
 * worse than today's "obfuscates everything" default, which at least fails loudly (a crash) rather
 * than quietly (a no-op that looks like it worked). An explicit, human-reviewed exclude list has no
 * such failure mode.
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
 * A fast, non-cryptographic string hash (djb2/xor variant) — used ONLY to turn a build's own
 * pre-obfuscation code into a small, deterministic `seed` for `javascript-obfuscator` (see
 * `buildObfuscatorOptions`'s own doc for why a seed matters at all). Passing the full `code` string
 * itself as `seed` was tried FIRST and rejected: confirmed empirically
 * (`javascript-obfuscator@4.2.2`) to make the library's own seed-to-PRNG-state conversion
 * pathologically slow on a realistic chunk size — a ~200KB seed never finished in 30+ seconds,
 * where the SAME content obfuscated with a short seed took under a second. Collisions are harmless
 * here (two DIFFERENT chunks that happen to hash the same still each get obfuscated correctly —
 * `seed` only controls the PRNG, not correctness), so a cheap 32-bit rolling hash is the right
 * tool, not a cryptographic digest.
 */
function hashCode(code: string): number {
  let hash = 5381
  for (let index = 0; index < code.length; index++) {
    hash = (hash * 33) ^ code.charCodeAt(index)
  }
  return hash >>> 0
}

/**
 * The `javascript-obfuscator` options both {@linkcode obfuscateFile} and
 * {@linkcode createObfuscationPlugin} share — one obfuscation behavior, not two independently
 * tuned ones, regardless of which build pipeline (esbuild's single-file `zanix build`, or Vite's
 * multi-chunk `zanix space build`) is calling it.
 *
 * `seed` is deterministic — derived from the pre-obfuscation `code` itself (via {@linkcode
 * hashCode}), not left to `javascript-obfuscator`'s own default `Math.random()`-backed shuffling —
 * so the SAME source, built twice with the SAME obfuscator version and options, produces
 * byte-identical output. This matters once obfuscation runs as a real Rollup/Vite transform (see
 * {@linkcode createObfuscationPlugin}'s own doc): the emitted chunk's content hash is computed
 * from this function's OWN return value, so a non-deterministic seed would mint a brand-new hash
 * — and bust every client's cache — on every rebuild, even one that changes nothing at all.
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
 * Obfuscates a single file's own already-built JS content in place — used ONLY by `zanix build`'s
 * single-file esbuild path (`build-runner.ts`'s `mainBuilderFunction`), whose `outputFile` is a
 * fixed, author-chosen path with no content hash in it. That's what makes an in-place post-build
 * rewrite safe there: nothing has already published a hash computed from the PRE-obfuscation
 * bytes for this path to invalidate.
 *
 * `zanix space build`'s own Vite/Rollup pipeline is a different case — see
 * {@linkcode createObfuscationPlugin}'s own doc for why that path obfuscates as a real build
 * transform instead of reusing this function.
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
 * Returns a real Vite/Rollup build plugin that obfuscates `zanix space build`'s own output — a
 * comet/CSS/client-entry chunk via `renderChunk`, and the generated `sw.js` service worker (a
 * fixed-name `generateBundle`-emitted asset, never a hashed chunk — see below) via
 * `generateBundle` — INSTEAD of the previous approach of reading each already-written, already
 * content-hashed file back off disk and overwriting it in place after `buildSpaceClient` returned.
 *
 * That previous approach broke content-addressing, a real, reported, and reproduced bug: Vite/
 * Rollup names every hashed output file (`assets/<name>-<hash>.js`) from the bundle's own
 * PRE-obfuscation content, and `@zanix/space`'s `AssetsRoute` serves every such file with
 * `Cache-Control: public, max-age=31536000, immutable`. Obfuscating those bytes AFTER that hash was
 * already minted — without ever changing the hash — means two builds that genuinely differ (a
 * changed `--obfuscate-exclude`, a bumped `javascript-obfuscator` version) can serve DIFFERENT
 * bytes under the EXACT SAME immutable URL. A browser that already cached the old bytes trusts
 * "immutable" to mean the URL's content never changes, and never refetches — silently stranding it
 * on stale (and, in the reported case, actively broken) code indefinitely. Reproduced in a real
 * consumer project (`aeratech-console`): a comet chunk obfuscated in one deploy, then added to
 * `--obfuscate-exclude` in the next to fix a real `javascript-obfuscator`-caused runtime crash
 * (`TypeError: _0x... is not a constructor`, a `@graphiql/toolkit` internal class broken by
 * identifier renaming), kept the IDENTICAL output filename across both deploys (the comet's own
 * source never changed — only the exclude config did) — a browser that had loaded the page before
 * the fix deployed kept executing the OLD, broken, obfuscated bytes under that same URL
 * indefinitely after the "fixed" build went live.
 *
 * `renderChunk` runs BEFORE Rollup/Vite substitute each chunk's `[hash]` placeholder in its own
 * filename — confirmed empirically (not assumed) against this project's own installed
 * `vite`/`rolldown` version: a `renderChunk` hook that mutates a chunk's code measurably changes
 * that chunk's own final emitted hash, with no extra `augmentChunkHash` needed. Obfuscating here
 * instead of post-build means the hash Vite mints is always computed from the ACTUAL served bytes
 * — the invariant `AssetsRoute`'s immutable caching depends on holds again, by construction, for
 * every future build regardless of how obfuscation config or the obfuscator's own version changes.
 *
 * `sw.js` needs a SEPARATE `generateBundle` hook rather than `renderChunk`, because `pwaPlugin`
 * emits it as a plain Rollup `asset` (`this.emitFile({ type: 'asset', fileName: 'sw.js', ... })`),
 * never a `chunk` — `renderChunk` only ever sees chunks. `sw.js` carries no content hash in its own
 * filename at all (a fixed name, precisely because a service worker's own URL must stay stable for
 * the browser to ever re-check it), so it was never exposed to THIS bug the way a hashed comet
 * chunk is — obfuscating it here is for architectural consistency (one in-pipeline pass, not a
 * leftover post-build one) rather than a second instance of the same hazard. Ordering is not
 * incidental: this plugin is appended AFTER `pwaPlugin` in `buildSpaceClient`'s own plugins array
 * (`action.ts`'s `plugins: [...]`), and Rollup runs same-hook plugins strictly in array order — so
 * `sw.js` already exists in `bundle` by the time this hook's own `generateBundle` runs. Confirmed
 * empirically, the same way the hash timing above was.
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
