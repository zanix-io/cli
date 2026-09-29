import { resolve as resolvePath, toFileUrl } from '@std/path'
import { findDenoConfigPath } from 'commands/space/shared/deno-config-discovery.ts'
import { getLoaderFor } from 'commands/space/shared/cli-loader.ts'
import {
  PROJECT_MANIFEST_FILE,
  resolveProjectSpecifier,
} from 'commands/space/shared/import-project-dependency.ts'
import { jsrPackageVersionFromResolvedUrl } from 'commands/space/shared/transitive-collision.ts'
import {
  type LockAligner,
  parseReleaseVersion,
  resolveRangeFresh,
  trackedRangeLiterals,
} from 'commands/space/shared/native-dependency-freshness.ts'

/**
 * Aligns the ranges of `@zanix/space` in `@zanix/cli`'s lock with the version a served project
 * resolves, so one copy of `@zanix/space` loads in the process.
 *
 * The project's direct imports (`@zanix/space`, `@zanix/space/preact`, `@zanix/space/dev`) resolve
 * through `importProjectDependency`, against the project's config. A published package the
 * project imports (e.g. `@zanix/iam`) imports `@zanix/space` itself, and that import resolves
 * through the lock that governs the process, so a pin older or newer than the project's loads a
 * second copy with its own module-level state (a renderer registry, a route registry).
 *
 * The target version is what the project's loader resolves: the newest release its declared range
 * allows, not the version in the project's `deno.lock`. The pin therefore follows every new
 * `@zanix/space` release the project's range admits, and the process restarts once under the
 * aligned lock when a release changes it.
 *
 * Only ranges the lock already tracks for `@zanix/space` are aligned, and only when the project's
 * version satisfies them. A range that a package adds later is not in the lock and resolves on
 * its own, so it can diverge again until the lock tracks it. Versions with major 0 and
 * prereleases are never aligned.
 *
 * @module
 */

const SPACE_PACKAGE = '@zanix/space'

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

/** The `@zanix/space` version `root` resolves, or `undefined` when it is not a published JSR
 * release (a local link, a workspace member) or `root` cannot resolve it at all. */
async function resolveProjectSpaceVersion(root: string): Promise<string | undefined> {
  try {
    const configPath = findDenoConfigPath(root)
    const loader = await getLoaderFor(configPath)
    const referrer = toFileUrl(resolvePath(root, PROJECT_MANIFEST_FILE)).href
    const resolved = await resolveProjectSpecifier(
      loader,
      referrer,
      configPath,
      SPACE_PACKAGE,
      new Set(),
    )
    return jsrPackageVersionFromResolvedUrl(resolved)
  } catch {
    return undefined
  }
}

/**
 * A {@linkcode LockAligner} that moves every tracked range of `@zanix/space` in `@zanix/cli`'s lock
 * to the version `root` resolves, when the two differ and the range admits that version. The
 * package's own lock block comes from an isolated resolution of that exact version. Best-effort:
 * any failure means no alignment, never a failure of `zanix space dev`/`build`.
 */
export function alignSpaceToProject(root: string): LockAligner {
  return async (cliLock) => {
    const projectVersion = await resolveProjectSpaceVersion(root)
    if (!projectVersion) return undefined

    const prefix = `jsr:${SPACE_PACKAGE}@`
    const ranges = trackedRangeLiterals(cliLock, SPACE_PACKAGE).filter((range) => {
      const pin = cliLock.specifiers?.[range]
      return pin !== undefined && pin !== projectVersion &&
        versionSatisfiesRange(projectVersion, range.slice(prefix.length))
    })
    if (ranges.length === 0) return undefined

    const probe = await resolveRangeFresh(`${prefix}${projectVersion}`)
    if (!probe) return undefined

    const pins = [...new Set(ranges.map((range) => cliLock.specifiers?.[range]))]
    return {
      updates: {
        specifiers: Object.fromEntries(ranges.map((range) => [range, projectVersion])),
        jsr: probe.lock.jsr ?? {},
        npm: probe.lock.npm ?? {},
      },
      description: `the lock pins ${SPACE_PACKAGE} ${pins.join(', ')} but this project resolves ` +
        `${projectVersion}`,
    }
  }
}
