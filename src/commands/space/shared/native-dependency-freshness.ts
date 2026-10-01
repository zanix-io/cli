import { dirname, join } from '@std/path'
import { getCliConfigPath } from 'commands/space/shared/cli-loader.ts'
import { GENERATED_MODULE_PREFIX } from 'commands/space/shared/specifier-reconstruction.ts'
import logger from '@zanix/utils/logger'

/**
 * Keeps the lock that governs `@zanix/cli`'s own process from pinning `@zanix/*` packages to
 * versions that split from the ones a served project loads. Imports made from inside a published
 * package (`@zanix/space`'s own imports of `@zanix/server`/`@zanix/app`, or a published package's
 * import of `@zanix/space`) and `dev/action.ts`'s/`import-space-app.ts`'s plain `import()` resolve
 * through the lock of the process: `@zanix/cli`'s own `deno.lock`, or the installed shim's
 * (`setup.ts`), which is equally frozen at whatever was newest when it was written. A served
 * project has no way to influence it.
 *
 * Two independent adjustments produce a merged COPY of that lock (the original is never touched),
 * and the caller re-execs the whole process under it:
 *
 * - **Freshness** ({@linkcode refreshTrackedRanges}): every range the lock tracks for
 *   `@zanix/server`/`@zanix/app` is re-resolved in isolation (a `deno info --json` probe against
 *   that literal alone, with its own temp lock). A caret/tilde/major-only range never resolves
 *   outside its major, so this never crosses a major `@zanix/cli` has not been tested against.
 * - **Alignment** (a {@linkcode LockAligner}, see `project-dependency-alignment.ts`): a range of
 *   a `@zanix/*` package the project declares, whose pin differs from what the project resolves,
 *   is moved to the project's version, so both load one copy of the package. Applied after
 *   freshness, so it wins for a `@zanix/server`/`@zanix/app` range the project also declares.
 *
 * The merged lock has to be a lock: a `scopes` config override has no effect on a package resolved
 * purely from JSR, whereas an entry in the lock the process consults does.
 *
 * @module
 */

/** Base package names the freshness adjustment keeps current. `@zanix/app/runtime` shares
 * `@zanix/app`'s base, since a lock's specifier keys are per package version. Not derived from
 * `PROJECT_ANCHORED_ONLY_PACKAGES` (`specifier-reconstruction.ts`): `@zanix/space` is excluded here
 * because its pin follows the project (alignment), never the newest release. */
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
export function parseReleaseVersion(version: string): [number, number, number] | undefined {
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
export async function resolveRangeFresh(
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
  resolvedSpecifiers: Record<string, string>
  jsr: Record<string, unknown>
  npm: Record<string, unknown>
  attempted: number
  succeeded: number
}> {
  const specifiers: Record<string, string> = {}
  const resolvedSpecifiers: Record<string, string> = {}
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
    Object.assign(resolvedSpecifiers, result.lock.specifiers)
    Object.assign(jsr, result.lock.jsr)
    Object.assign(npm, result.lock.npm)
  }
  return { specifiers, resolvedSpecifiers, jsr, npm, attempted: ranges.length, succeeded }
}

/** How long a real check's own result stays trusted before this module is willing to pay for
 * another one — the same 24h window Deno's own `minimumDependencyAge` default already uses
 * elsewhere in this codebase, reused here for the identical reason: a real release published
 * `zanix space dev`/`build` startup ago is still real a few restarts later. Without this,
 * `watchSpaceAppFile`'s own "a `space.app.ts` change restarts this whole process" behavior would
 * mean every single edit during active development pays for a fresh network round trip per
 * tracked range — six `deno info` subprocess spawns, unconditionally, on every restart. */
export const FRESHNESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Deliberately NOT `GENERATED_MODULE_PREFIX`-named — that convention marks a file as ephemeral,
 * safe for `sweepStaleGeneratedModules` to delete the moment it's found sitting around; THIS file
 * is a real, meant-to-persist-across-runs cache, and sweeping it away would silently defeat its own
 * purpose (paying for a fresh check on the very next run regardless of how recent the last one
 * was). Lives as a sibling of `@zanix/cli`'s own lock — the same directory `locateCliLockPath`
 * already resolves for every other real artifact this module reads/writes. */
const FRESHNESS_CACHE_FILENAME = '.zanix-native-freshness-cache.json'

/** Bumped whenever {@linkcode FreshnessCache}'s shape changes; a cache written under another
 * schema is a miss. Schema 2 added `resolvedSpecifiers`: a schema-1 entry merges `jsr` blocks
 * without the specifiers their dependencies reference, which yields a lock Deno refuses to read. */
const FRESHNESS_CACHE_SCHEMA = 2

/** What {@linkcode readFreshnessCache}/{@linkcode writeFreshnessCache} persist — literally the same
 * `specifiers`/`jsr`/`npm` shape {@linkcode prepareNativeFreshnessReexec} already merges from a LIVE
 * check, so a cache hit can build the identical merged lock without paying for another `deno info`
 * round trip at all. `checkedAt` is an ISO timestamp, compared against {@linkcode FRESHNESS_CACHE_TTL_MS}
 * — an EMPTY `specifiers` here is a real, meaningful cached answer too ("checked recently, nothing
 * newer than what's already pinned"), not treated any differently from a cache holding real updates. */
interface FreshnessCache extends LockUpdates {
  schema: number
  checkedAt: string
}

/** Reads a still-fresh cache sitting next to `cliLockPath`, or `undefined` when there's none, it's
 * malformed, or it's older than {@linkcode FRESHNESS_CACHE_TTL_MS} — any of which means a real,
 * live check is owed instead. */
async function readFreshnessCache(cliLockPath: string): Promise<FreshnessCache | undefined> {
  try {
    const cache = JSON.parse(
      await Deno.readTextFile(join(dirname(cliLockPath), FRESHNESS_CACHE_FILENAME)),
    ) as FreshnessCache
    if (cache.schema !== FRESHNESS_CACHE_SCHEMA) return undefined
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
  entry: LockUpdates,
): Promise<void> {
  const cache: FreshnessCache = {
    schema: FRESHNESS_CACHE_SCHEMA,
    checkedAt: new Date().toISOString(),
    ...entry,
  }
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

/** The base of an npm lock key (`name@version`): a key resolved with peer dependencies carries
 * them after the version (`preact@10.29.8_preact-render-to-string@6.7.0`). */
function npmKeyBase(key: string): string {
  return /^(@?[^@]+@[^_]+)/.exec(key)?.[1] ?? key
}

/**
 * A copy of `cliLock` with the `updates` applied. `specifiers` are overwritten. `resolvedSpecifiers`
 * are only added: a `jsr` block taken from an isolated resolution lists its dependencies by the
 * specifier keys of that resolution (`jsr:@zanix/server@^4.3.4`), and Deno refuses to read a lock
 * whose block references a key missing from `specifiers` (`Invalid jsr dependency`). `jsr` and `npm`
 * blocks are only added, never replaced, and an `npm` block is skipped when the lock already holds
 * that package version, whatever its peer suffix. An isolated resolution of a single package
 * resolves peer dependencies differently from the full graph (`preact` and `preact-render-to-string`
 * get peer-suffixed together), and one such extra `npm` block, referenced or not, makes Deno
 * install a second copy of the package.
 */
export function mergeLockUpdates(
  cliLock: DenoLockFile,
  updates: Array<LockUpdates | undefined>,
): DenoLockFile {
  const jsr = { ...cliLock.jsr }
  const npm = { ...cliLock.npm }
  const npmBases = new Set(Object.keys(npm).map(npmKeyBase))
  const specifiers = { ...cliLock.specifiers }

  for (const update of updates) {
    if (!update) continue
    for (const [key, version] of Object.entries(update.resolvedSpecifiers ?? {})) {
      if (!(key in specifiers)) specifiers[key] = version
    }
    Object.assign(specifiers, update.specifiers)
    for (const [key, block] of Object.entries(update.jsr)) {
      if (!(key in jsr)) jsr[key] = block
    }
    for (const [key, block] of Object.entries(update.npm)) {
      if (key in npm || npmBases.has(npmKeyBase(key))) continue
      npm[key] = block
      npmBases.add(npmKeyBase(key))
    }
  }
  return { ...cliLock, specifiers, jsr, npm }
}

/**
 * Whether Deno can read `lock` at all. A merged lock is assembled from fragments of other locks, so
 * it can be one Deno rejects outright (`Failed deserializing. Lockfile may be corrupt`), and a
 * re-exec under it would fail on every start.
 *
 * The check runs `deno info --no-config` on an empty module, against a throwaway copy of the lock:
 * Deno deserializes the whole lock before resolving anything, and rewrites it afterward, so the
 * copy keeps the lock under test untouched. It needs no network and takes milliseconds. A failure
 * to run the check at all counts as unreadable.
 */
export async function isLockReadable(lock: DenoLockFile): Promise<boolean> {
  const dir = await Deno.makeTempDir({ prefix: `${GENERATED_MODULE_PREFIX}lock-check-` })
  try {
    const lockPath = join(dir, 'deno.lock')
    const entryPath = join(dir, 'entry.ts')
    await Deno.writeTextFile(lockPath, JSON.stringify(lock))
    await Deno.writeTextFile(entryPath, 'export {}\n')
    const { success } = await new Deno.Command(Deno.execPath(), {
      args: ['info', '--no-config', '--json', '--lock', lockPath, entryPath],
      stdout: 'null',
      stderr: 'null',
    }).output()
    return success
  } catch {
    return false
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

/** The lock entries a lock adjustment merges into a copy of `@zanix/cli`'s lock. */
export interface LockUpdates {
  /** Pins to set, overwriting the lock's. */
  specifiers: Record<string, string>
  /** The `specifiers` table of the isolated resolution the `jsr`/`npm` blocks come from, added
   * only where the lock lacks a key. */
  resolvedSpecifiers?: Record<string, string>
  jsr: Record<string, unknown>
  npm: Record<string, unknown>
}

/** Computes the entries that bring `cliLock` in line with a served project, or `undefined` when it
 * already is (or cannot be determined). `description` is the reason shown to the user when it
 * triggers a restart. */
export type LockAligner = (
  cliLock: DenoLockFile,
) => Promise<{ updates: LockUpdates; description: string } | undefined>

/** A merged lock to re-exec under, and the reasons it differs from `@zanix/cli`'s own. */
export interface NativeFreshnessReexec {
  lockPath: string
  reasons: string[]
}

/**
 * Writes a merged COPY of `@zanix/cli`'s lock, to an uncommitted temporary file, when either
 * adjustment finds something to change: a tracked range of {@linkcode NATIVE_DEPENDENCY_PACKAGES}
 * resolves newer than its pin, or `align` reports a difference. Returns `undefined` otherwise,
 * which is the common case on every run.
 *
 * A live freshness check runs once per {@linkcode FRESHNESS_CACHE_TTL_MS}; a cache hit skips the
 * network, and a cached empty result means nothing to change. A run where every tracked range
 * failed to resolve (no network, a registry outage) is never cached, so the next run retries.
 * Alignment is not cached: it depends on the project, and costs one local resolution and a
 * comparison unless it finds a difference.
 *
 * A merged lock Deno cannot read ({@linkcode isLockReadable}) is discarded with a warning, and the
 * process runs under `@zanix/cli`'s own lock: possibly stale, but it starts.
 *
 * The merged lock stays on disk for the re-exec'd child to read for its whole lifetime. The
 * caller's `Deno.exit` runs no cleanup, so `sweepStaleGeneratedModules` removes it on a later run
 * (see `native-dependency-freshness-guard.ts`).
 *
 * @param options.noCache - Skips {@linkcode readFreshnessCache} and always runs a live freshness
 * check (`--no-cache` of `dev`/`build`). It still writes a fresh cache entry afterward.
 * @param options.align - Optional alignment of the lock with the served project.
 */
export async function prepareNativeFreshnessReexec(
  { noCache = false, align }: { noCache?: boolean; align?: LockAligner } = {},
): Promise<NativeFreshnessReexec | undefined> {
  if (Deno.env.get(NATIVE_FRESHNESS_REEXEC_ENV)) return undefined

  const cliLockPath = await locateCliLockPath()
  if (!cliLockPath) return undefined

  let cliLock: DenoLockFile
  try {
    cliLock = JSON.parse(await Deno.readTextFile(cliLockPath)) as DenoLockFile
  } catch {
    return undefined
  }

  let updates: LockUpdates
  const cached = noCache ? undefined : await readFreshnessCache(cliLockPath)
  if (cached) {
    updates = cached
  } else {
    const perPackage = await Promise.all(
      NATIVE_DEPENDENCY_PACKAGES.map((packageBase) => refreshTrackedRanges(cliLock, packageBase)),
    )
    updates = {
      specifiers: Object.assign({}, ...perPackage.map((result) => result.specifiers)),
      resolvedSpecifiers: Object.assign(
        {},
        ...perPackage.map((result) => result.resolvedSpecifiers),
      ),
      jsr: Object.assign({}, ...perPackage.map((result) => result.jsr)),
      npm: Object.assign({}, ...perPackage.map((result) => result.npm)),
    }
    const totalAttempted = perPackage.reduce((sum, result) => sum + result.attempted, 0)
    const totalSucceeded = perPackage.reduce((sum, result) => sum + result.succeeded, 0)
    // When every range that was tried failed to resolve, the empty result is not an answer worth
    // trusting for a day. Only `totalAttempted === 0` (nothing to check) is a real empty answer.
    if (totalAttempted === 0 || totalSucceeded > 0) {
      await writeFreshnessCache(cliLockPath, updates)
    }
  }

  const reasons: string[] = []
  if (Object.keys(updates.specifiers).length > 0) {
    reasons.push('a newer @zanix/server/@zanix/app than the lock pins')
  }
  const alignment = await align?.(cliLock)
  if (alignment) reasons.push(alignment.description)
  if (reasons.length === 0) return undefined

  const mergedLock = mergeLockUpdates(cliLock, [updates, alignment?.updates])
  if (!(await isLockReadable(mergedLock))) {
    logger.warn(
      `Skipping the adjusted copy of @zanix/cli's lock (${reasons.join('; ')}): Deno cannot read ` +
        `it. Running under the lock as installed, so these packages may load at their pinned ` +
        `versions. Please report this with \`zanix report-issue\`.`,
    )
    return undefined
  }

  const lockPath = join(
    dirname(cliLockPath),
    `${GENERATED_MODULE_PREFIX}native-freshness-${crypto.randomUUID()}.lock.json`,
  )
  await Deno.writeTextFile(lockPath, JSON.stringify(mergedLock, null, 2))
  return { lockPath, reasons }
}
