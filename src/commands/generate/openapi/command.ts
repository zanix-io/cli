import type { Commander } from 'cli'
import type { DiscoveredRoute } from 'commands/generate/openapi/spec-builder.ts'

import { assertProjectType } from 'commands/generate/shared/project.ts'
import { discoverRoutes } from 'commands/generate/openapi/discover.ts'
import { planOpenapiSpec } from 'commands/generate/openapi/spec-builder.ts'
import logger from '@zanix/utils/logger'

/**
 * Pure planning for `zanix generate openapi`: given every REST route the target project's own
 * `@zanix/core`/`@zanix/server` actually discovered (already filtered by `--application`, if any),
 * returns the exact JSON text to write at the project root's `openapi.json` — indentation included,
 * so the CLI action's own job is nothing but a single `Deno.writeTextFile` call.
 */
export function planOpenapi(routes: DiscoveredRoute[]): string {
  return `${JSON.stringify(planOpenapiSpec(routes), null, 2)}\n`
}

/**
 * `zanix generate openapi [root]`'s real orchestration: discovers the target project's own REST
 * routes (via a real `deno run` subprocess rooted at `root` — see `discover.ts`), builds the spec,
 * and writes `openapi.json` at the PROJECT ROOT.
 *
 * Deliberately regenerates the whole file on every run, unlike every other generator on this page —
 * `openapi.json` is a machine-derived snapshot of the project's current route metadata, not a
 * hand-editable shell a generator seeds once and then leaves alone. There is nothing in it for a
 * project owner to safely hand-edit between runs; re-running is how it stays accurate.
 *
 * This is the one generator that actually EXECUTES the target project's own code (via the
 * `discoverRoutes` subprocess) rather than only writing files — deliberately scoped to the CURRENT
 * project only (`root` defaults to `Deno.cwd()`, never a remote or arbitrary path passed in from
 * outside this command), the same trust boundary running `deno task`/`deno run` inside your own
 * project already implies.
 *
 * `--include-admin` (off by default) forwards `{ admin: true }` to the target project's own
 * `Zanix.compose` call, surfacing `@zanix/admin`'s built-in `'admin'`-Application routes
 * (`/admin/service-token`, and whichever of `/admin/triggers`/`/admin/templates` that project's own
 * deployment enables) alongside its regular ones. Deliberately opt-in, mirroring `Zanix.compose`'s
 * (and `Zanix.start`'s) own `admin` option default — the admin surface is anchored and not meant to
 * be reachable by an arbitrary public caller, so it stays out of a generated OpenAPI document unless
 * explicitly asked for, the same trust posture every other Zanix entry point already gives it.
 * `--application admin` (the existing, fully generic filter) is how a caller narrows an
 * `--include-admin` run down to JUST the admin routes, once discovered.
 */
async function generateOpenapiAction(
  this: Commander,
  options: unknown,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'openapi', root)

  const { application, includeAdmin } = options as { application?: string; includeAdmin?: boolean }
  const projectRoot = root ?? Deno.cwd()

  let routes
  try {
    routes = await discoverRoutes(projectRoot, undefined, includeAdmin)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  const filteredRoutes = application
    ? routes.filter((route) => route.application === application)
    : routes

  await Deno.writeTextFile(
    `${projectRoot}/openapi.json`,
    planOpenapi(filteredRoutes),
  )

  logger.info("OpenAPI spec written successfully to 'openapi.json'.")
}

export default generateOpenapiAction

export function registerOpenapiCommand(cwd: Commander): void {
  cwd.command('openapi')
    .description(
      "Statically introspect the project's own REST route metadata and write a full OpenAPI " +
        "spec to 'openapi.json' at the project root. Unlike every other generator, this OVERWRITES " +
        'openapi.json on every run — it is a machine-derived snapshot, not a hand-editable shell.',
    )
    .option(
      '-a --application <name:string>',
      'Only include routes registered under this Application. Omit to include every discovered ' +
        'route.',
    )
    .option(
      '--include-admin',
      "Opt-in: also discover @zanix/admin's built-in 'admin'-Application routes " +
        '(/admin/service-token, /admin/triggers, /admin/templates). Off by default — the admin ' +
        'surface is anchored, not meant for an arbitrary public caller.',
    )
    .arguments('[root:string]')
    .action((options, ...args) => {
      return generateOpenapiAction.call(cwd, options, ...args)
    })
}
