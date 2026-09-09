import {
  NATIVE_FRESHNESS_REEXEC_ENV,
  prepareNativeFreshnessReexec,
} from 'commands/space/shared/native-dependency-freshness.ts'
import logger from '@zanix/utils/logger'

/**
 * Runs at the very start of `zanix space dev`/`build`, alongside (never instead of)
 * `transitive-collision-guard.ts`'s own `guardAgainstTransitiveCollisions` — a separate check for a
 * separate hazard, at the same "before anything resolves a single project specifier" startup slot.
 *
 * If {@linkcode prepareNativeFreshnessReexec} finds `@zanix/server`/`@zanix/app` genuinely resolving
 * newer than what `@zanix/cli`'s own committed lock has pinned, restarts the WHOLE process
 * (mirroring `guardAgainstTransitiveCollisions`'s own re-exec precedent) under the merged lock it
 * prepared, WAITS for it, and exits with the SAME code the child exits with — never returns in this
 * case. The common case — nothing newer available — is a single, cheap set of isolated `deno info`
 * probes and nothing else: no re-exec, no extra process, this function just returns.
 *
 * The merged lock file itself is deliberately left on disk here, same as
 * `guardAgainstTransitiveCollisions`'s own merged config — `Deno.exit` below terminates the process
 * immediately, before any code after it (a `finally` included) ever runs, so there is no point this
 * function could reliably delete it itself. `sweepStaleGeneratedModules`'s own next-run sweep of
 * `native-dependency-freshness.ts`'s own directory is what actually reclaims it.
 */
export async function guardAgainstStaleNativeDependencies(): Promise<void> {
  const mergedLockPath = await prepareNativeFreshnessReexec()
  if (mergedLockPath === undefined) return

  logger.info(
    "A newer @zanix/server/@zanix/app is available than @zanix/cli's own committed lock — " +
      'restarting under a refreshed lock to pick it up...',
  )
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--lock', mergedLockPath, Deno.mainModule, ...Deno.args],
    env: { [NATIVE_FRESHNESS_REEXEC_ENV]: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const { code } = await child.status
  Deno.exit(code)
}
