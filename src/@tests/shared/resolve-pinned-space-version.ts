import { join } from '@std/path'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'

/**
 * Resolves `ZANIX_DEPENDENCY_VERSIONS['@zanix/space']`'s own floating range (`^X.Y.Z`) to the EXACT
 * concrete version `cli`'s own committed `deno.lock` already resolves it to — e.g.
 * `jsr:@zanix/space@1.6.0`, never the unexpanded `jsr:@zanix/space@^1.6.0` range.
 *
 * A fixture that writes a scaffolded project's own `deno.json` for a test exercising `zanix space
 * build`/`dev`/`runDevValidation` IN-PROCESS (`importSpaceApp`/`importProjectDependency`,
 * `import-project-module.ts`) needs this EXACT form, never the floating range: that project-anchored
 * resolution runs through its own, separate `@deno/loader` `Workspace`, with no `deno.lock` of its
 * own next to the fixture's generated `deno.json` — a floating range there re-resolves fresh against
 * whatever `@zanix/space` version is CURRENTLY latest on `jsr.io`, a live target that moves
 * independently of, and can outrun, `cli`'s own locked import. A test file that also natively
 * imports `@zanix/space` (resolved against `cli`'s OWN `deno.jsonc`/`deno.lock`, never re-queried)
 * then loads TWO different concrete `@zanix/space` module instances in the same process — each
 * instance's `SpaceDevSocket` static initializer registers the identical dev-socket route into
 * `@zanix/server`'s one shared `RouteContainer`, and the second registration throws `Route path
 * "socket=>/__zanix_space_dev__" is already defined`. The same race reproduces even within a single
 * test FILE with no native `@zanix/space` import at all, purely across that file's own separate test
 * cases: each one's own `importProjectDependency` call re-queries the live registry independently, so
 * two calls separated by a real `@zanix/space` release landing in between resolve to different
 * versions and collide the same way. An exact version has no "latest matching" query left to
 * re-run — every call resolves the identical URL regardless of what else gets published on the
 * registry meanwhile.
 *
 * Reads `cli`'s own root `deno.lock` directly (assumes `Deno.cwd()` is the repo root — true for
 * every real `deno test` invocation, local or CI) rather than duplicating the resolved version as a
 * second, hand-maintained constant: `deno.lock`'s own `specifiers` map already IS the answer `cli`'s
 * native `@zanix/space` import resolves to, staying in sync automatically with whatever last
 * regenerated the lock file.
 *
 * @module
 */

let pinnedVersionPromise: Promise<string> | undefined

/** Returns `jsr:@zanix/space@<exact version>` — see this module's own doc for why every in-process
 * `zanix space build`/`dev` fixture needs this instead of `ZANIX_DEPENDENCY_VERSIONS['@zanix/space']`
 * directly. Memoized: `deno.lock` is read once per process and reused for every caller. */
export function resolvePinnedSpaceVersion(): Promise<string> {
  pinnedVersionPromise ??= (async () => {
    const range = ZANIX_DEPENDENCY_VERSIONS['@zanix/space']
    const lockPath = join(Deno.cwd(), 'deno.lock')
    const lock = JSON.parse(await Deno.readTextFile(lockPath)) as {
      specifiers?: Record<string, string>
    }
    const version = lock.specifiers?.[range]
    if (!version) {
      throw new Error(
        `deno.lock has no locked entry for '${range}' (ZANIX_DEPENDENCY_VERSIONS['@zanix/space']) ` +
          `— run 'deno test' once with network access from the repo root to populate it, then ` +
          `commit the updated deno.lock.`,
      )
    }
    return `jsr:@zanix/space@${version}`
  })()
  return pinnedVersionPromise
}
