import { resolve } from '@std/path'
import { Commander } from 'cli'
import { readLockfileSpecifiers } from 'commands/check-duplicates/lib/lockfile.ts'
import { findDuplicateZanixDeps } from 'commands/check-duplicates/lib/analyze.ts'
import { formatReport } from 'commands/check-duplicates/lib/report.ts'
import logger from '@zanix/logger'

/**
 * `zanix check-duplicates` — the automated check for a real, confirmed bug class in this
 * ecosystem: `@zanix/server`'s DI container (`BaseInstancesContainer#getInstance`) keys a target
 * by the identity of its own class reference (a `WeakMap<constructor, key>` in `getTargetKey`),
 * and every `@Provider`/`@Connector`-style decorator validates with `instanceof` against a base
 * class — both identity-based, not name-based. When a downstream package (e.g. `@zanix/core`)
 * still pins a pre-major range (`~0.8.1`) for a dependency an app also pulls directly at a new
 * major (`^1.0.0`), the ranges don't overlap and Deno keeps BOTH resolved versions live in the
 * same `deno.lock` — two physically different copies of "the same" class. Whichever copy gets
 * decorated registers under ITS OWN key; a caller resolving the OTHER copy finds nothing
 * registered and the DI container throws `TypeError: Target is not a constructor` with
 * `targetName: "'unknown': there is no metadata information"` — a real incident, not a
 * hypothetical (`@zanix/auth`/`@zanix/notifications` both duplicated this way once).
 *
 * A bare `Commander` instance (not registered via `baseArgumentActionCommand`), same shape as
 * `check-cycles`'s own command — this command has no sub-leaves of its own and never calls
 * `this.runCommand(...)`.
 *
 * Deliberately pure lockfile inspection, no dependency resolution of its own: it reads
 * `deno.lock`'s already-resolved `specifiers` map and groups it by `@zanix/*` package name (see
 * `lib/analyze.ts`). A package resolved to more than one distinct version at once is reported as
 * a finding; a repo with a healthy, single-version `deno.lock` reports clean.
 */
export default function checkDuplicatesCommand(this: Commander) {
  const cwd = new Commander()

  this.mountGroup('check-duplicates', cwd)
    .description(
      "Checks a project's deno.lock for a '@zanix/*' package resolved to more than one " +
        "distinct version at once — the dual-package-hazard shape that makes @zanix/server's " +
        'identity-keyed DI container throw "Target is not a constructor" for a class that is ' +
        'really just the same class loaded twice. Exits non-zero on a confirmed finding, so ' +
        'this is safe to gate a CI job on.',
    )
    .option(
      '-p --path <path:string>',
      'The project root to check (must have its own deno.lock). Defaults to the current ' +
        'working directory.',
      { default: '.' },
    )
    .action(async (options) => {
      const root = resolve((options as { path: string }).path)

      let specifiers: Record<string, string>
      try {
        specifiers = await readLockfileSpecifiers(root)
      } catch (error) {
        cwd.throw(error instanceof Error ? error : new Error(String(error)))
        return
      }

      const findings = findDuplicateZanixDeps(specifiers)
      const report = formatReport(root, findings)

      if (findings.length > 0) {
        cwd.throw(new Error(`Confirmed '@zanix/*' dependency drift:\n${report}`))
        return
      }

      logger.info(report)
    })
}
