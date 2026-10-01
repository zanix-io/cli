import { ResolutionMode } from '@deno/loader'
import { parse as parseJsonc } from '@std/jsonc'
import { dirname, join, resolve as resolvePath, toFileUrl } from '@std/path'
import {
  findDenoConfigPath,
  findNearestPlainConfigPath,
} from 'commands/space/shared/deno-config-discovery.ts'
import { getLoaderFor } from 'commands/space/shared/cli-loader.ts'
import { PROJECT_MANIFEST_FILE } from 'commands/space/shared/import-project-dependency.ts'
import { jsrPackageVersionFromResolvedUrl } from 'commands/space/shared/transitive-collision.ts'
import {
  type DenoLockFile,
  FRESHNESS_CACHE_TTL_MS,
  isNewerRelease,
  locateCliLockPath,
  type LockAligner,
  type LockUpdates,
  parseReleaseVersion,
  resolveRangeFresh,
  trackedRangeLiterals,
} from 'commands/space/shared/native-dependency-freshness.ts'
import logger from '@zanix/utils/logger'

/**
 * Aligns every `@zanix/*` package a served project declares with the version that project
 * resolves, in `@zanix/cli`'s lock, so the process loads one copy of each.
 *
 * The project's direct imports resolve through `importProjectDependency`/`importProjectModule`,
 * against the project's config. A published package the project imports resolves its own imports
 * through the lock that governs the process instead: `@zanix/iam` importing
 * `jsr:@zanix/space-ui@^2.4.0` loads whatever that lock pins for `^2.4.0`. When that pin differs
 * from the project's `@zanix/space-ui`, which copy a module gets depends on load order: Deno reuses
 * a version already loaded when it satisfies the range, and applies the pin otherwise. The second
 * copy has its own module-level state (a renderer registry, a context created by `createContext`).
 *
 * The target version of a package is what the project's loader resolves: the newest release its
 * declared range allows, not the version in the project's `deno.lock`. That is also what a direct
 * import of the project resolves to in the process, since the lock tracks none of the project's
 * own ranges. Every range the lock tracks for that package and that admits the target is moved to
 * it, and the process restarts once under the aligned lock.
 *
 * A range is never moved below its pin: `@zanix/cli`'s own code imports most of these packages
 * too, and only ever ran against that pin or a newer one. A range that does not admit the target
 * (another major), or whose pin is newer than the target, keeps its pin and is reported with a
 * warning. `@zanix/space` is the exception to the second rule and moves in both directions, as it
 * did before every other package was aligned: its renderer and route registries must be one
 * instance whatever the version. A package the project does not declare, a target with major 0 or
 * a prerelease, and `@zanix/cli` itself are never aligned.
 *
 * The project's versions are cached next to `@zanix/cli`'s lock for {@linkcode
 * FRESHNESS_CACHE_TTL_MS}, keyed by the project's root and invalidated when its configs or its
 * `deno.lock` change, so a restart does not resolve them again.
 *
 * @module
 */

/** `jsr:@zanix/<name>@<range>`, optionally followed by a subpath. */
const ZANIX_JSR_IMPORT_RE = /^jsr:(@zanix\/[^@/]+)@([^/]+)/

/** Never aligned: the CLI's own package is not a dependency of the served project. */
const EXCLUDED_PACKAGES = new Set(['@zanix/cli'])

/** Moved to the project's version even when that is older than the pin. See the module doc. */
const DOWNGRADABLE_PACKAGES = new Set(['@zanix/space'])

/** Sibling of `@zanix/cli`'s lock, like the freshness cache. Not `GENERATED_MODULE_PREFIX`-named,
 * which would let `sweepStaleGeneratedModules` delete it. */
const ALIGNMENT_CACHE_FILENAME = '.zanix-project-alignment-cache.json'

/** `N`, `N.M`, `N.M.P`, each optionally prefixed by `^` or `~`. */
const RANGE_RE = /^([\^~]?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/

/**
 * Whether `version` (`X.Y.Z`) satisfies `range` (the part after `@` in a lock's
 * `jsr:@scope/name@<range>` key). Supports `N[.M[.P]]`, `^` and `~` forms. Returns `false` for a
 * major of 0 (caret semantics differ there), a prerelease, or any other range syntax.
 */
export function versionSatisfiesRange(version: string, range: string): boolean {
  const parsed = parseReleaseVersion(version)
  const match = RANGE_RE.exec(range)
  if (!parsed || !match) return false

  const [, operator, majorText, minorText, patchText] = match
  const major = Number(majorText)
  if (major < 1 || parsed[0] !== major) return false

  const minor = minorText === undefined ? undefined : Number(minorText)
  const patch = patchText === undefined ? undefined : Number(patchText)
  const atLeastLowerBound = parsed[1] > (minor ?? 0) ||
    (parsed[1] === (minor ?? 0) && parsed[2] >= (patch ?? 0))
  const sameMinor = minor === undefined || parsed[1] === minor

  if (operator === '^') return atLeastLowerBound
  if (operator === '~') return sameMinor && atLeastLowerBound
  return sameMinor && (patch === undefined || parsed[2] === patch)
}

/** The `imports` map of `configPath`, or `{}` when it is missing or does not parse. */
function readImports(configPath: string | undefined): Record<string, string> {
  if (!configPath) return {}
  try {
    const parsed = parseJsonc(Deno.readTextFileSync(configPath)) as { imports?: unknown }
    const imports = parsed?.imports
    if (typeof imports !== 'object' || imports === null) return {}
    return Object.fromEntries(
      Object.entries(imports).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'
      ),
    )
  } catch {
    return {}
  }
}

/**
 * One import key per `@zanix/*` package `root` declares, keyed by package name. Reads the nearest
 * config first and then a workspace root above it, so a member's own declaration wins.
 */
export function projectZanixImportKeys(root: string): Map<string, string> {
  const keys = new Map<string, string>()
  const memberConfig = findNearestPlainConfigPath(root)
  const workspaceConfig = findDenoConfigPath(root)
  const configs = workspaceConfig === memberConfig
    ? [memberConfig]
    : [memberConfig, workspaceConfig]
  for (const configPath of configs) {
    for (const [key, value] of Object.entries(readImports(configPath))) {
      const base = ZANIX_JSR_IMPORT_RE.exec(value)?.[1]
      if (base && !EXCLUDED_PACKAGES.has(base) && !keys.has(base)) keys.set(base, key)
    }
  }
  return keys
}

/** The version `root` resolves for each `@zanix/*` package it declares. A package whose
 * resolution fails, or that resolves to anything but a published JSR release, is left out. */
async function resolveProjectZanixVersions(root: string): Promise<Map<string, string>> {
  const keys = projectZanixImportKeys(root)
  if (keys.size === 0) return new Map()

  const loader = await getLoaderFor(findDenoConfigPath(root))
  const referrer = toFileUrl(resolvePath(root, PROJECT_MANIFEST_FILE)).href
  const literals = new Map<string, string>()
  for (const [base, key] of keys) {
    try {
      literals.set(base, loader.resolveSync(key, referrer, ResolutionMode.Import))
    } catch {
      // Not resolvable from the project: nothing to align this package with.
    }
  }
  await loader.addEntrypoints(
    [...literals.values()].filter((literal) => literal.startsWith('jsr:')),
  )

  const versions = new Map<string, string>()
  for (const [base, literal] of literals) {
    try {
      const resolved = literal.startsWith('jsr:')
        ? loader.resolveSync(literal, referrer, ResolutionMode.Import)
        : literal
      const version = jsrPackageVersionFromResolvedUrl(resolved)
      if (version) versions.set(base, version)
    } catch {
      // Same as above.
    }
  }
  return versions
}

/** The configs and the `deno.lock` that decide what `root` resolves. */
function projectResolutionFiles(root: string): string[] {
  const memberConfig = findNearestPlainConfigPath(root)
  const workspaceConfig = findDenoConfigPath(root)
  const configs = [...new Set([memberConfig, workspaceConfig])].filter((path) => path !== undefined)
  const lockDir = dirname(workspaceConfig ?? memberConfig ?? join(root, 'deno.json'))
  return [...configs, join(lockDir, 'deno.lock')]
}

/** A hash of the paths and contents of {@linkcode projectResolutionFiles}; a missing file counts
 * as empty. */
async function projectFingerprint(root: string): Promise<string> {
  const parts = projectResolutionFiles(root).map((path) => {
    let content = ''
    try {
      content = Deno.readTextFileSync(path)
    } catch {
      // A project without a lock (or a config) yet: hashed as empty.
    }
    return `${path}\0${content}`
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\0')))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface AlignmentCacheEntry {
  fingerprint: string
  checkedAt: string
  versions: Record<string, string>
}

/** The project's versions from the cache, or a fresh resolution written back to it. A failure to
 * read or write the cache only costs a fresh resolution. */
async function cachedProjectZanixVersions(
  root: string,
  noCache: boolean,
): Promise<Map<string, string>> {
  const cliLockPath = await locateCliLockPath()
  const cachePath = cliLockPath && join(dirname(cliLockPath), ALIGNMENT_CACHE_FILENAME)
  const key = resolvePath(root)
  const fingerprint = await projectFingerprint(root)

  let cache: Record<string, AlignmentCacheEntry> = {}
  if (cachePath) {
    try {
      cache = JSON.parse(await Deno.readTextFile(cachePath))
    } catch {
      cache = {}
    }
  }
  const entry = cache[key]
  const age = entry ? Date.now() - new Date(entry.checkedAt).getTime() : NaN
  if (
    !noCache && entry?.fingerprint === fingerprint && Number.isFinite(age) && age >= 0 &&
    age < FRESHNESS_CACHE_TTL_MS
  ) {
    return new Map(Object.entries(entry.versions))
  }

  const versions = await resolveProjectZanixVersions(root)
  if (cachePath) {
    // Entries past the TTL are dropped, so roots that are gone do not accumulate.
    cache = Object.fromEntries(
      Object.entries(cache).filter(([, cached]) =>
        Date.now() - new Date(cached?.checkedAt).getTime() < FRESHNESS_CACHE_TTL_MS
      ),
    )
    cache[key] = {
      fingerprint,
      checkedAt: new Date().toISOString(),
      versions: Object.fromEntries(versions),
    }
    await Deno.writeTextFile(cachePath, JSON.stringify(cache, null, 2)).catch(() => {})
  }
  return versions
}

/** What {@linkcode planAlignment} found for one package. */
export interface PackageAlignment {
  /** The version the project resolves. */
  version: string
  /** The pins being replaced, deduplicated. */
  pins: string[]
}

/** A range that keeps its own pin: it does not admit the project's version (`'range'`), or its
 * pin is newer than that version (`'older'`). */
export interface UnalignableRange {
  range: string
  pin: string
  version: string
  reason: 'range' | 'older'
}

/** The pure part of {@linkcode alignZanixPackagesToProject}: which lock entries change. */
export interface AlignmentPlan {
  /** Range literal (`jsr:@zanix/space-ui@^2.4.0`) → the project's version. */
  specifiers: Record<string, string>
  /** Per package, the version it moves to and the pins it replaces. */
  packages: Map<string, PackageAlignment>
  /** Lock block keys (`@zanix/space-ui@2.5.3`) the lock lacks for a target version. */
  missingBlocks: string[]
  unalignable: UnalignableRange[]
}

/**
 * Plans the alignment of `cliLock` with `projectVersions` (package name → the project's version).
 * A package whose version is not a release with major 1 or above is skipped entirely, and a pin is
 * never moved to an older version, except for {@linkcode DOWNGRADABLE_PACKAGES}.
 */
export function planAlignment(
  cliLock: DenoLockFile,
  projectVersions: Map<string, string>,
): AlignmentPlan {
  const plan: AlignmentPlan = {
    specifiers: {},
    packages: new Map(),
    missingBlocks: [],
    unalignable: [],
  }
  for (const [base, version] of [...projectVersions].sort(([a], [b]) => a < b ? -1 : 1)) {
    const parsed = parseReleaseVersion(version)
    if (!parsed || parsed[0] < 1) continue

    const prefix = `jsr:${base}@`
    const pins = new Set<string>()
    for (const range of trackedRangeLiterals(cliLock, base)) {
      const pin = cliLock.specifiers?.[range]
      if (pin === undefined || pin === version) continue
      if (!versionSatisfiesRange(version, range.slice(prefix.length))) {
        plan.unalignable.push({ range, pin, version, reason: 'range' })
      } else if (!DOWNGRADABLE_PACKAGES.has(base) && isNewerRelease(pin, version)) {
        plan.unalignable.push({ range, pin, version, reason: 'older' })
      } else {
        plan.specifiers[range] = version
        pins.add(pin)
      }
    }
    if (pins.size === 0) continue
    plan.packages.set(base, { version, pins: [...pins].sort() })
    if (!(`${base}@${version}` in (cliLock.jsr ?? {}))) {
      plan.missingBlocks.push(`${base}@${version}`)
    }
  }
  return plan
}

/**
 * A {@linkcode LockAligner} that moves every range of `@zanix/cli`'s lock to the version `root`
 * resolves for that package, when the two differ and the range admits that version (see
 * {@linkcode planAlignment}). `noCache` (`--no-cache`) skips the cached project versions. A version the
 * lock has no block for gets one from an isolated resolution of that exact version; a package
 * whose resolution fails is left unaligned. Best-effort: any other failure means no alignment,
 * never a failure of `zanix space dev`/`build`.
 */
export function alignZanixPackagesToProject(root: string, noCache = false): LockAligner {
  return async (cliLock) => {
    let plan: AlignmentPlan
    try {
      plan = planAlignment(cliLock, await cachedProjectZanixVersions(root, noCache))
    } catch {
      return undefined
    }

    for (const { range, pin, version, reason } of plan.unalignable) {
      logger.warn(
        reason === 'range'
          ? `@zanix/cli's lock pins ${range} to ${pin}, which this project's ${version} does not ` +
            'satisfy. A package that imports that range loads a second copy.'
          : `This project resolves ${version}, older than the ${pin} @zanix/cli's lock pins for ` +
            `${range}, which keeps that pin. A package that imports that range loads a second ` +
            'copy; updating the project to the newer release removes it.',
      )
    }
    if (plan.packages.size === 0) return undefined

    const probes = await Promise.all(
      plan.missingBlocks.map(async (block) => ({
        block,
        probe: await resolveRangeFresh(`jsr:${block}`),
      })),
    )
    const resolvedSpecifiers: Record<string, string> = {}
    const updates: LockUpdates = { specifiers: {}, resolvedSpecifiers, jsr: {}, npm: {} }
    const failed = new Set<string>()
    for (const { block, probe } of probes) {
      if (!probe) {
        failed.add(block.slice(0, block.lastIndexOf('@')))
        continue
      }
      Object.assign(resolvedSpecifiers, probe.lock.specifiers)
      Object.assign(updates.jsr, probe.lock.jsr)
      Object.assign(updates.npm, probe.lock.npm)
    }

    const descriptions: string[] = []
    for (const [base, { version, pins }] of plan.packages) {
      if (failed.has(base)) continue
      for (const range of trackedRangeLiterals(cliLock, base)) {
        if (plan.specifiers[range] !== undefined) updates.specifiers[range] = plan.specifiers[range]
      }
      descriptions.push(`${base} ${pins.join(', ')} but this project resolves ${version}`)
    }
    if (descriptions.length === 0) return undefined

    return { updates, description: `the lock pins ${descriptions.join('; ')}` }
  }
}
