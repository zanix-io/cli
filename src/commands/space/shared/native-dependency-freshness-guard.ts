import { dirname, join } from '@std/path'
import {
  NATIVE_FRESHNESS_REEXEC_ENV,
  prepareNativeFreshnessReexec,
} from 'commands/space/shared/native-dependency-freshness.ts'
import { alignZanixPackagesToProject } from 'commands/space/shared/project-dependency-alignment.ts'
import { getCliConfigPath } from 'commands/space/shared/cli-loader.ts'
import logger from '@zanix/utils/logger'

/**
 * Runs at the start of `zanix space dev`/`build`, next to `guardAgainstTransitiveCollisions` and
 * before anything resolves a project specifier.
 *
 * When {@linkcode prepareNativeFreshnessReexec} finds `@zanix/cli`'s lock out of line with what the
 * project loads (a newer `@zanix/server`/`@zanix/app`, or a `@zanix/*` package pinned at a different
 * version than the project resolves), the whole process restarts under the merged lock it wrote,
 * waits for the child, and exits with the child's code; the function never returns in that case.
 * Otherwise it costs a few isolated `deno info` probes and a local resolution of the project's
 * `@zanix/*` imports, and returns.
 *
 * The merged lock stays on disk: `Deno.exit` runs no code after it, so nothing here can delete it.
 * `sweepStaleGeneratedModules` removes it on a later run.
 *
 * The child also gets `--config`. Without it, the child discovers a config from `Deno.cwd()`, the
 * served project's directory, and loses `@zanix/cli`'s own path aliases (`commands/`, `typings/`,
 * `shared/`, `utils/`), so its source cannot resolve itself. `getCliConfigPath()` gives the config
 * of a local checkout; a global install has none, so this falls back to the shim's generated
 * `deno.json`, a sibling of the lock in every install shape.
 *
 * @param root - The served project's root, whose `@zanix/*` resolutions the lock is aligned
 * with.
 * @param noCache - Forwarded to {@linkcode prepareNativeFreshnessReexec} (`--no-cache`): forces a
 * live freshness check instead of trusting a cached one.
 */
export async function guardAgainstStaleNativeDependencies(
  root: string,
  noCache = false,
): Promise<void> {
  const reexec = await prepareNativeFreshnessReexec({
    noCache,
    align: alignZanixPackagesToProject(root, noCache),
  })
  if (reexec === undefined) return

  const configPath = getCliConfigPath() ?? join(dirname(reexec.lockPath), 'deno.json')

  logger.info(
    `Restarting under an adjusted copy of @zanix/cli's lock: ${reexec.reasons.join('; ')}...`,
  )
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      '--config',
      configPath,
      '--lock',
      reexec.lockPath,
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
