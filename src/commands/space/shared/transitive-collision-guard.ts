import {
  prepareTransitiveCollisionReexec,
  TRANSITIVE_REEXEC_ENV,
} from 'commands/space/shared/transitive-collision.ts'
import { readLockfileSpecifiers } from 'commands/check-duplicates/lib/lockfile.ts'
import { findDuplicateZanixDeps } from 'commands/check-duplicates/lib/analyze.ts'
import { formatReport } from 'commands/check-duplicates/lib/report.ts'
import logger from '@zanix/utils/logger'

/**
 * Runs at the very start of `zanix space dev`/`build`, before anything resolves a single project
 * specifier — the two independent, additive halves of the fix for a confirmed bug: `@zanix/server`
 * (or any `@zanix/*` package) can load as two separate module instances when a served project
 * imports it both directly and transitively through a third-party `@zanix/*` package it also
 * imports directly (see `import-project-module.ts`'s own
 * {@linkcode prepareTransitiveCollisionReexec}/`detectTransitiveCollisionPackages` doc for the full
 * mechanism).
 *
 * 1. **Re-exec, when needed.** If a genuine collision risk is detected for `root` and this process
 *    isn't already the re-exec'd child, restarts the WHOLE process (mirroring `dev/action.ts`'s own
 *    `watchSpaceAppFile` re-exec precedent) under the config `prepareTransitiveCollisionReexec`
 *    prepared, WAITS for it, and exits with the SAME code the child exits with — never returns in
 *    this case. Waiting (rather than a fire-and-forget spawn) matters for `zanix space build`
 *    specifically: a one-shot command whose own exit code a CI script relies on to know whether
 *    the build actually succeeded — `stdin`/`stdout`/`stderr` stay `'inherit'`, so the user-visible
 *    output is identical either way. Every specifier resolution `dev`/`build` does AFTER calling
 *    this function is guaranteed to run either under a process already fixed up this way, or one
 *    with no collision risk to begin with.
 * 2. **Pre-flight diagnostic, always — a genuinely DIFFERENT, related hazard, not the one Step 1
 *    fixes.** A non-fatal warning, reusing `zanix check-duplicates`'s own pure lockfile inspection
 *    (`readLockfileSpecifiers`/`findDuplicateZanixDeps`/`formatReport`): it can only ever catch a
 *    `@zanix/*` package resolved to two DIFFERENT versions within `root`'s OWN `deno.lock` — e.g. a
 *    downstream package still pinning a pre-major range against a direct import at a new major.
 *    That is NOT the same-version, two-SEPARATE-instances hazard Step 1 fixes: THAT one happens
 *    across two entirely different resolution mechanisms (this project's own `@deno/loader`
 *    resolution vs. a third-party package's own internal manifest, resolved natively by whatever
 *    governs the running process) and is invisible in any single project's own lockfile — it can
 *    coexist with a perfectly clean `deno.lock`. Kept here purely because it shares this same
 *    "run once, before anything resolves" startup slot, catches a real, adjacent class of drift,
 *    and costs nothing (a project with no `deno.lock` yet just has nothing to check).
 */
export async function guardAgainstTransitiveCollisions(root: string): Promise<void> {
  const reexecConfigPath = await prepareTransitiveCollisionReexec(root)
  if (reexecConfigPath !== undefined) {
    logger.info(
      'Detected a package that both this project and one of its own dependencies need — ' +
        'restarting under a shared configuration to keep them as one module instance...',
    )
    const child = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', '--config', reexecConfigPath, Deno.mainModule, ...Deno.args],
      env: { [TRANSITIVE_REEXEC_ENV]: '1' },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn()
    const { code } = await child.status
    Deno.exit(code)
  }

  try {
    const specifiers = await readLockfileSpecifiers(root)
    const findings = findDuplicateZanixDeps(specifiers)
    if (findings.length > 0) {
      logger.warn(
        `Potential @zanix/* module-identity hazard detected in deno.lock:\n${
          formatReport(root, findings)
        }`,
      )
    }
  } catch {
    // No deno.lock yet (first run, or a project that's never run `deno install`) — nothing to
    // check yet, and never a reason to block dev/build startup.
  }
}
