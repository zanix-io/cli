import type { Commander } from 'cli'

import { assertSafeProjectName } from 'utils/projects/validate-name.ts'

/**
 * Guards a `zanix generate <artifact> <name>` argument against path-traversal before anything is
 * written to disk — the same protection `zanix new` already gets from `assertSafeProjectName`,
 * applied across every `<name>`-taking generator's own user-supplied argument instead of trusting
 * each `command.ts` to sanitize it individually. Reuses `assertSafeProjectName` as-is (rejects
 * empty and any `..` segment), routed through `cwd.throw` (Cliffy's `throwErrors()`-configured
 * error pipeline) so an unsafe value surfaces as a clear error + exit 1 — same convention
 * `new/actions/*.ts` already uses.
 *
 * Not used by the four `<route-path>`-taking generators (`page`/`layout`/`error`/`loading`) — their
 * route path legitimately IS the empty string for the app's root route/root layout (e.g.
 * `zanix generate layout ''`), which would be wrongly rejected as an empty name. Those four use
 * `assertSafeGeneratorRoutePath` below instead.
 *
 * Call this immediately after `assertProjectType` and before deriving any case-transformed name or
 * folder path from the raw argument.
 */
export function assertSafeGeneratorName(cwd: Commander, name: string): void {
  try {
    assertSafeProjectName(name)
  } catch (error) {
    cwd.throw(error as Error)
  }
}

/**
 * Guards a `zanix generate <page|layout|error|loading> <route-path>` argument against
 * path-traversal before anything is written to disk — the `<route-path>`-taking counterpart to
 * `assertSafeGeneratorName` above. Reuses `assertSafeProjectName` with `{ allowEmpty: true }`
 * because, unlike a plain `<name>`, a route path legitimately IS the empty string: it addresses the
 * app's root route (`page`/`error`/`loading`) or root layout (`layout`), and each of those four
 * generators already writes to `${projectRoot}/src/space/routes/${routePath}` for that case. It
 * still unconditionally rejects any `..` segment (e.g. `'../../../../victim'`), the same escape
 * vector `assertSafeGeneratorName` guards against, routed through the same `cwd.throw` pipeline.
 *
 * Call this immediately after `assertProjectType` and before deriving any route folder path from
 * the raw argument.
 */
export function assertSafeGeneratorRoutePath(cwd: Commander, routePath: string): void {
  try {
    assertSafeProjectName(routePath, { allowEmpty: true })
  } catch (error) {
    cwd.throw(error as Error)
  }
}
