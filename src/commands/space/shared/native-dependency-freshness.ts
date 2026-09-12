import { dirname, join } from '@std/path'
import { getCliConfigPath } from 'commands/space/shared/cli-loader.ts'
import { GENERATED_MODULE_PREFIX } from 'commands/space/shared/specifier-reconstruction.ts'

/**
 * Keeps `@zanix/server`/`@zanix/app`'s own NATIVE resolution (`dev/action.ts`'s/`import-space-
 * app.ts`'s own plain `import()` — see each call site's own doc) from silently drifting behind
 * whatever's actually published, without ever touching a served project's own resolution and
 * without un-pinning anything ELSE `@zanix/cli` depends on.
 *
 * Native resolution converges `@zanix/cli`'s own orchestration with `@zanix/space`'s own internal
 * imports of the same two packages — correct by construction, since both then resolve through the
 * IDENTICAL mechanism (see `import-project-dependency.ts`'s own module doc for the full history).
 * The cost: that mechanism reads whatever `@zanix/cli`'s OWN committed `deno.lock` already has
 * pinned for these two packages — frozen at whatever was newest the day that lock was last
 * generated, with no built-in reason to ever re-check. A served project has no way to ask for
 * anything newer, and neither does a consumer who installed `@zanix/cli` a while ago — the shim's
 * own lock (`setup.ts`'s own doc) is exactly as frozen, for exactly the same reason.
 *
 * This module closes that gap WITHOUT reintroducing the divergence native resolution itself fixed:
 * for each range `@zanix/cli`'s own lock ALREADY tracks for `@zanix/server`/`@zanix/app` (its own
 * declared range, `@zanix/space`'s own internal one, and any other package's — see
 * {@linkcode refreshTrackedRanges}'s own doc for why every one of them is safe to check, not just
 * the two this package happens to know about by name), it re-resolves that EXACT range literal
 * fresh, in total isolation (a real `deno info --json` probe against nothing but that literal, in
 * its own temp lock — never touching `@zanix/cli`'s own committed one). A caret/tilde/major-only
 * range can never resolve outside its own major by definition, so this can never silently cross a
 * major `@zanix/cli` itself hasn't been tested against, no matter how new an actual release is.
 * When a genuinely NEWER version comes back, {@linkcode prepareNativeFreshnessReexec} writes a
 * real, valid, merged COPY of `@zanix/cli`'s own lock (every entry untouched except the ranges that
 * just resolved newer) and hands its path back for the caller to re-exec the whole process under —
 * mirroring `transitive-collision.ts`'s own `prepareTransitiveCollisionReexec`/re-exec precedent,
 * just at the LOCK layer instead of the config layer (a `scopes` config override was tried first
 * and confirmed, via a real repro, to have no effect on a package resolved purely from JSR — only
 * an entry in the LOCK a process's whole native resolution actually consults does).
 *
 * @module
 */

/** Base package names this module keeps fresh — `@zanix/app/runtime` shares `@zanix/app`'s own
 * base, so checking `@zanix/app` once already covers it (a lock's own specifier keys are per
 * PACKAGE VERSION, shared across every subpath of it). Kept as its own list, deliberately not
 * derived from `PROJECT_ANCHORED_ONLY_PACKAGES` (`specifier-reconstruction.ts`) — that set also
 * includes `@zanix/space`, which resolves project-anchored, never natively, and has no staleness
 * gap of this kind to close in the first place. */
const NATIVE_DEPENDENCY_PACKAGES = ['@zanix/server', '@zanix/app']

/** The one filename `@zanix/cli`'s own real installer (`installation/setup.ts`'s own `BIN_NAME`)
 * writes its global shim under — kept in sync BY HAND with that constant, the same "no real reason
 * to import a whole standalone installer script just for one string" reasoning
 * `import-project-dependency.ts`'s own `PROJECT_MANIFEST_FILE` already documents for itself. */
const BIN_NAME = 'zanix'

/** `@zanix/cli`'s OWN real, currently-governing `deno.lock` — the one file every check and every
 * merge in this module reads from and writes a fixed-up COPY of, never the original.
 *
 * A local checkout (`cliConfigPath` a real path) keeps it as a direct sibling of its own config —
 * read straight off disk, no network involved. A genuine global install (`cliConfigPath`
 * `undefined`, per `cli-loader.ts`'s own doc) has no local config file to sit next to at all; its
 * OWN lock instead lives at a fixed, well-known path under wherever `deno install -g` itself wrote
 * the shim — the exact same formula `setup.ts`'s own lockfile-sync step already computes
 * (`${DENO_INSTALL_ROOT}/bin/.${BIN_NAME}/deno.lock`), replicated here rather than imported (that
 * script is a one-shot, standalone installer, never a module anything else in this package should
 * depend on). Returns `undefined` when neither location holds a real, readable file — nothing to
 * merge a fix into, so this whole mechanism has nothing to offer this run (never a reason to fail
 * `zanix space dev`/`build` itself over it).
 *
 * Exported so `import-project-module.ts`'s own `sweepStaleGeneratedModules` can sweep the SAME
 * directory {@linkcode prepareNativeFreshnessReexec} writes its own merged-lock temp file into — a
 * killed process leaving one behind there would otherwise never be swept by anything, since it
 * sits in `@zanix/cli`'s own directory, never a served project's. */
export async function locateCliLockPath(): Promise<string | undefined> {
  const cliConfigPath = getCliConfigPath()
  const candidate = cliConfigPath ? join(dirname(cliConfigPath), 'deno.lock') : (() => {
    const installRoot = Deno.env.get('DENO_INSTALL_ROOT') ??
      `${Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE')}/.deno`
    return `${installRoot}/bin/.${BIN_NAME}/deno.lock`
  })()
  try {
    const stat = await Deno.stat(candidate)
    return stat.isFile ? candidate : undefined
  } catch {
    return undefined
  }
}

/** Parses a real JSR release version (`X.Y.Z`, always what a published `@zanix/server`/`@zanix/app`
 * version looks like — neither publishes a prerelease) into a 3-tuple for a real numeric compare —
 * `deno info`'s own resolved version string is never anything else for these two packages, so a
 * dedicated `@std/semver` dependency buys nothing a plain split/parse doesn't already cover here.
 * Returns `undefined` for anything that doesn't match, so a malformed/unexpected string degrades to
 * "not newer" rather than a wrong comparison. */
function parseReleaseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** `true` only when `candidate` is a real, strictly newer release than `current` — same major
 * always guaranteed by the CALLER (a caret/tilde/major-only range can never resolve outside its own
 * major to begin with, so this never itself needs to check that). Either string failing to parse
 * degrades to `false` — never "newer" on uncertain data. */
export function isNewerRelease(candidate: string, current: string): boolean {
  const a = parseReleaseVersion(candidate)
  const b = parseReleaseVersion(current)
  if (!a || !b) return false
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]
}

/** Minimal shape of a real `deno.lock` this module reads/writes — every OTHER field (`version`,
 * `redirects`, `workspace`, `remote`, ...) is round-tripped untouched via a plain object spread,
 * never modeled here. */
export interface DenoLockFile {
  specifiers?: Record<string, string>
  jsr?: Record<string, unknown>
  npm?: Record<string, unknown>
  [key: string]: unknown
}

/** Resolves `rangeLiteral` (e.g. `jsr:@zanix/server@^4.1.0`) fresh, in total isolation — a real
 * `deno info --json` probe with its OWN throwaway `--lock`, never `@zanix/cli`'s own committed one,
 * so nothing about this check can itself perturb the running process's own resolution. Returns the
 * resolved version plus whatever `specifiers`/`jsr`/`npm` entries that isolated resolve produced
 * (that package's own real, complete dependency graph — not just its own top-level entry), or
 * `undefined` on any failure (network hiccup, an unreachable registry, a malformed range) — this
 * check is a pure freshness probe, never something that should block `zanix space dev`/`build`
 * starting over a failure to even ask the question.
 *
 * The resolved version is read back from the LOCK FILE `--lock` itself writes, not `deno info`'s
 * own stdout — confirmed empirically that passing a bare `jsr:pkg@range` literal directly as the
 * entry (rather than a real file importing it) leaves stdout's own `roots[0]` as that SAME
 * unresolved literal, never the fully-resolved URL a real file entry's `roots[0]` would report. The
 * written lock's own `specifiers[rangeLiteral]` has no such ambiguity — it's the resolved VERSION
 * string directly, by definition of what that field is.
 *
 * `tempLockPath` is a COMPUTED path, deliberately never `Deno.makeTempFile()`'s own result used
 * directly — that call creates a real, EMPTY file at the path it returns, and `deno info --json
 * --lock <path>` treats an already-existing file as one to READ, failing outright ("Lockfile was
 * empty") instead of writing a fresh one there — confirmed via a real repro. Creating, then
 * immediately deleting, a real temp file is what gets a genuinely unique path with none of that
 * baggage. */
async function resolveRangeFresh(
  rangeLiteral: string,
): Promise<{ version: string; lock: DenoLockFile } | undefined> {
  const placeholder = await Deno.makeTempFile({
    prefix: `${GENERATED_MODULE_PREFIX}freshness-`,
    suffix: '.lock.json',
  })
  await Deno.remove(placeholder)
  const tempLockPath = placeholder
  try {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        'info',
        '--json',
        '--lock',
        tempLockPath,
        '--minimum-dependency-age',
        '0',
        rangeLiteral,
      ],
      stdout: 'null',
      stderr: 'null',
    })
    const { success } = await command.output()
    if (!success) return undefined

    const lock = JSON.parse(await Deno.readTextFile(tempLockPath)) as DenoLockFile
    const version = lock.specifiers?.[rangeLiteral]
    if (!version) return undefined

    return { version, lock }
  } catch {
    return undefined
  } finally {
    await Deno.remove(tempLockPath).catch(() => {})
  }
}

/** Every specifier key `cliLock` already tracks for `packageBase` (`jsr:@zanix/server@^4.1.0`,
 * `jsr:@zanix/server@^4.2.1`, ... — whichever ranges genuinely ended up in `@zanix/cli`'s own lock
 * the last time it was generated, from `@zanix/cli`'s own declared range, `@zanix/space`'s own
 * internal one, or any OTHER package's — a real, confirmed case exists where a THIRD package
 * (`@zanix/datamaster`) contributed one too). Checking every one of them, not just the two ranges
 * this module happens to know the NAMES of packages that declare, is what keeps this correct
 * without this module needing to know who declares what: whichever of them resolves genuinely
 * newer today gets refreshed, and nothing this module can't already see stays exactly as `@zanix/
 * cli`'s own lock already had it. */
export function trackedRangeLiterals(cliLock: DenoLockFile, packageBase: string): string[] {
  const prefix = `jsr:${packageBase}@`
  return Object.keys(cliLock.specifiers ?? {}).filter((key) => key.startsWith(prefix))
}

/** Checks every tracked range for `packageBase` against a fresh, isolated resolve of that SAME
 * literal, and returns the specifiers/jsr/npm ENTRIES to merge into a fixed-up copy of `cliLock`
 * for whichever ranges resolved genuinely newer — `{}` when none did (the common case, checked on
 * every `zanix space dev`/`build` start: nothing to merge, nothing to re-exec for). Best-effort per
 * range: one range's own resolve failing never stops the others from being checked.
 *
 * `attempted`/`succeeded` (real resolves that came back at all, whether or not they found
 * something NEWER — a successful check confirming "already up to date" still counts) let the
 * caller tell "genuinely checked, nothing newer" apart from "every single check failed" (no
 * network, a registry outage) — see {@linkcode prepareNativeFreshnessReexec}'s own doc for why that
 * distinction is the one thing worth tracking here. */
export async function refreshTrackedRanges(cliLock: DenoLockFile, packageBase: string): Promise<{
  specifiers: Record<string, string>
  jsr: Record<string, unknown>
  npm: Record<string, unknown>
  attempted: number
  succeeded: number
}> {
  const specifiers: Record<string, string> = {}
  const jsr: Record<string, unknown> = {}
  const npm: Record<string, unknown> = {}

  const ranges = trackedRangeLiterals(cliLock, packageBase)
  const results = await Promise.all(ranges.map((range) => resolveRangeFresh(range)))
  let succeeded = 0
  for (const [index, result] of results.entries()) {
    if (!result) continue
    succeeded++
    const range = ranges[index]
    const current = cliLock.specifiers?.[range]
    if (!current || !isNewerRelease(result.version, current)) continue
    specifiers[range] = result.version
    Object.assign(jsr, result.lock.jsr)
    Object.assign(npm, result.lock.npm)
  }
  return { specifiers, jsr, npm, attempted: ranges.length, succeeded }
}

/** How long a real check's own result stays trusted before this module is willing to pay for
 * another one — the same 24h window Deno's own `minimumDependencyAge` default already uses
 * elsewhere in this codebase, reused here for the identical reason: a real release published
 * `zanix space dev`/`build` startup ago is still real a few restarts later. Without this,
 * `watchSpaceAppFile`'s own "a `space.app.ts` change restarts this whole process" behavior would
 * mean every single edit during active development pays for a fresh network round trip per
 * tracked range — six `deno info` subprocess spawns, unconditionally, on every restart. */
const FRESHNESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Deliberately NOT `GENERATED_MODULE_PREFIX`-named — that convention marks a file as ephemeral,
 * safe for `sweepStaleGeneratedModules` to delete the moment it's found sitting around; THIS file
 * is a real, meant-to-persist-across-runs cache, and sweeping it away would silently defeat its own
 * purpose (paying for a fresh check on the very next run regardless of how recent the last one
 * was). Lives as a sibling of `@zanix/cli`'s own lock — the same directory `locateCliLockPath`
 * already resolves for every other real artifact this module reads/writes. */
const FRESHNESS_CACHE_FILENAME = '.zanix-native-freshness-cache.json'

/** What {@linkcode readFreshnessCache}/{@linkcode writeFreshnessCache} persist — literally the same
 * `specifiers`/`jsr`/`npm` shape {@linkcode prepareNativeFreshnessReexec} already merges from a LIVE
 * check, so a cache hit can build the identical merged lock without paying for another `deno info`
 * round trip at all. `checkedAt` is an ISO timestamp, compared against {@linkcode FRESHNESS_CACHE_TTL_MS}
 * — an EMPTY `specifiers` here is a real, meaningful cached answer too ("checked recently, nothing
 * newer than what's already pinned"), not treated any differently from a cache holding real updates. */
interface FreshnessCache {
  checkedAt: string
  specifiers: Record<string, string>
  jsr: Record<string, unknown>
  npm: Record<string, unknown>
}

/** Reads a still-fresh cache sitting next to `cliLockPath`, or `undefined` when there's none, it's
 * malformed, or it's older than {@linkcode FRESHNESS_CACHE_TTL_MS} — any of which means a real,
 * live check is owed instead. */
async function readFreshnessCache(cliLockPath: string): Promise<FreshnessCache | undefined> {
  try {
    const cache = JSON.parse(
      await Deno.readTextFile(join(dirname(cliLockPath), FRESHNESS_CACHE_FILENAME)),
    ) as FreshnessCache
    const age = Date.now() - new Date(cache.checkedAt).getTime()
    return Number.isFinite(age) && age >= 0 && age < FRESHNESS_CACHE_TTL_MS ? cache : undefined
  } catch {
    return undefined
  }
}

/** Best-effort — a failure to WRITE the cache never fails `zanix space dev`/`build` itself; it just
 * means the next run pays for a live check again instead of reusing this one, same as if the cache
 * had simply expired. */
async function writeFreshnessCache(
  cliLockPath: string,
  entry: Omit<FreshnessCache, 'checkedAt'>,
): Promise<void> {
  const cache: FreshnessCache = { checkedAt: new Date().toISOString(), ...entry }
  await Deno.writeTextFile(
    join(dirname(cliLockPath), FRESHNESS_CACHE_FILENAME),
    JSON.stringify(cache, null, 2),
  ).catch(() => {})
}

/** Guard env var a caller MUST set (to `'1'`, or any truthy string) on the re-exec'd child process
 * it spawns from a {@linkcode prepareNativeFreshnessReexec} result — same "detection is structural,
 * independent of which lock governs the CURRENT process, so it would otherwise re-detect the
 * identical freshness gap every time and loop forever" reasoning `transitive-collision.ts`'s own
 * `TRANSITIVE_REEXEC_ENV` already documents for itself. Exported so `dev/action.ts`/`build/action.ts`
 * set the exact same name this function itself checks. */
export const NATIVE_FRESHNESS_REEXEC_ENV = 'ZANIX_NATIVE_FRESHNESS_REEXEC'

/**
 * When at least one of {@linkcode NATIVE_DEPENDENCY_PACKAGES}'s own tracked ranges resolves
 * genuinely newer than what `@zanix/cli`'s own lock already has, writes a real, valid, merged COPY
 * of that lock (every entry untouched except the ranges that resolved newer) to a real, uncommitted
 * temporary file, and returns its path for the caller to re-exec the whole process under (`--lock
 * <path>`) — never returns anything when nothing needs it, the common case on every real run.
 *
 * A real, live check only actually runs once per {@linkcode FRESHNESS_CACHE_TTL_MS} — see
 * {@linkcode readFreshnessCache}'s own doc for why. A cache hit skips the network entirely, either
 * way: an EMPTY cached result means "already returns `undefined` here, nothing to re-exec for" just
 * as much as a live check finding nothing does. A run with NO network access at all (every tracked
 * range's own resolve fails) is never written to the cache in the first place — see
 * {@linkcode refreshTrackedRanges}'s own doc — so it costs nothing beyond that one run's own
 * failed attempt, and the very next `zanix space dev`/`build` invocation genuinely retries instead
 * of silently trusting a result that was never really checked.
 *
 * The merged lock file itself is left on disk for the caller's own re-exec'd child process to keep
 * reading for its entire lifetime, same as `prepareTransitiveCollisionReexec`'s own merged config —
 * `sweepStaleGeneratedModules`'s own next-run sweep is what actually reclaims it (the caller's own
 * `Deno.exit` right after spawning the child never lets any of its own cleanup code run, so trying
 * to delete it there would never fire in practice — see `native-dependency-freshness-guard.ts`'s
 * own doc).
 *
 * @param noCache - Skips {@linkcode readFreshnessCache} and always runs a real, live check instead
 * — `--no-cache` (`dev`/`build`'s own `command.ts`), for a maintainer who just published a new
 * `@zanix/server`/`@zanix/app` and doesn't want to wait out {@linkcode FRESHNESS_CACHE_TTL_MS} (or
 * hunt down and delete the cache file by hand) to have it actually picked up. Still WRITES a fresh
 * cache entry afterward, same as an ordinary cache-miss check — this only ever skips the READ.
 */
export async function prepareNativeFreshnessReexec(
  noCache = false,
): Promise<string | undefined> {
  if (Deno.env.get(NATIVE_FRESHNESS_REEXEC_ENV)) return undefined

  const cliLockPath = await locateCliLockPath()
  if (!cliLockPath) return undefined

  let cliLock: DenoLockFile
  try {
    cliLock = JSON.parse(await Deno.readTextFile(cliLockPath)) as DenoLockFile
  } catch {
    return undefined
  }

  let updates: Omit<FreshnessCache, 'checkedAt'>
  const cached = noCache ? undefined : await readFreshnessCache(cliLockPath)
  if (cached) {
    updates = cached
  } else {
    const perPackage = await Promise.all(
      NATIVE_DEPENDENCY_PACKAGES.map((packageBase) => refreshTrackedRanges(cliLock, packageBase)),
    )
    updates = {
      specifiers: Object.assign({}, ...perPackage.map((result) => result.specifiers)),
      jsr: Object.assign({}, ...perPackage.map((result) => result.jsr)),
      npm: Object.assign({}, ...perPackage.map((result) => result.npm)),
    }
    const totalAttempted = perPackage.reduce((sum, result) => sum + result.attempted, 0)
    const totalSucceeded = perPackage.reduce((sum, result) => sum + result.succeeded, 0)
    // A genuine "checked, nothing newer" result is cached normally — but when every single range
    // this run actually tried to resolve came back failed (no network, a registry outage), that's
    // never a real answer worth trusting for a full day: writing it to the cache would silence
    // every later check until the TTL expires, even the instant connectivity comes back. Only
    // `totalAttempted === 0` (nothing to check at all) still caches — an empty result there is a
    // real, meaningful answer, not a failure.
    if (totalAttempted === 0 || totalSucceeded > 0) {
      await writeFreshnessCache(cliLockPath, updates)
    }
  }

  if (Object.keys(updates.specifiers).length === 0) return undefined

  const mergedLock: DenoLockFile = {
    ...cliLock,
    specifiers: { ...cliLock.specifiers, ...updates.specifiers },
    jsr: { ...cliLock.jsr, ...updates.jsr },
    npm: { ...cliLock.npm, ...updates.npm },
  }

  const mergedPath = join(
    dirname(cliLockPath),
    `${GENERATED_MODULE_PREFIX}native-freshness-${crypto.randomUUID()}.lock.json`,
  )
  await Deno.writeTextFile(mergedPath, JSON.stringify(mergedLock, null, 2))
  return mergedPath
}
