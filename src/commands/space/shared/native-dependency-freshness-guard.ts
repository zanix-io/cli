import { dirname, join } from '@std/path'
import {
  NATIVE_FRESHNESS_REEXEC_ENV,
  prepareNativeFreshnessReexec,
} from 'commands/space/shared/native-dependency-freshness.ts'
import { getCliConfigPath } from 'commands/space/shared/cli-loader.ts'
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
 *
 * **The re-exec'd child ALSO gets `--config`, not just `--lock`.** Without it, the child does its
 * own config-file auto-discovery from `Deno.cwd()` — the SERVED PROJECT's own directory during a
 * real `zanix space dev`/`build` run, never `@zanix/cli`'s own — so the child loses every one of
 * `@zanix/cli`'s own internal path aliases (`commands/`, `typings/`, `shared/`, `utils/`) its own
 * source needs to resolve itself at all. Confirmed via a real repro, not the "unreproduced outside
 * CI" gap an earlier version of this doc described: the child printed `zanix space`'s own group
 * help text instead of running the command, then threw `Module not found
 * "https://jsr.io/@zanix/space/.../bundler/preact/debug"` — both symptoms of `@zanix/cli`'s own
 * command-registration graph failing to resolve itself, not anything specific to `space`/`dev`.
 * `getCliConfigPath()` gives the real answer for a local checkout; a genuine global install (that
 * function returns `undefined` there, by design — see its own doc) has no local config of its own
 * to point at, so this falls back to the shim's own generated `deno.json`, the guaranteed sibling of
 * `cliLockPath` in every install shape (`native-dependency-freshness.ts`'s own `locateCliLockPath`
 * doc) — the exact file `mergedLockPath` (just resolved) is itself already a sibling of.
 *
 * @param noCache - Forwarded to {@linkcode prepareNativeFreshnessReexec} — `--no-cache` (`dev`/
 * `build`'s own `command.ts`), for a maintainer actively publishing `@zanix/server`/`@zanix/app`
 * who wants this run to actually notice, rather than trusting an earlier check's cached result for
 * the rest of that function's own cache TTL (`native-dependency-freshness.ts`'s own
 * `FRESHNESS_CACHE_TTL_MS`).
 */
export async function guardAgainstStaleNativeDependencies(noCache = false): Promise<void> {
  const mergedLockPath = await prepareNativeFreshnessReexec(noCache)
  if (mergedLockPath === undefined) return

  const configPath = getCliConfigPath() ?? join(dirname(mergedLockPath), 'deno.json')

  logger.info(
    "A newer @zanix/server/@zanix/app is available than @zanix/cli's own committed lock — " +
      'restarting under a refreshed lock to pick it up...',
  )
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      '--config',
      configPath,
      '--lock',
      mergedLockPath,
      Deno.mainModule,
      ...Deno.args,
    ],
    env: { [NATIVE_FRESHNESS_REEXEC_ENV]: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const { code } = await child.status
  Deno.exit(code)
}
