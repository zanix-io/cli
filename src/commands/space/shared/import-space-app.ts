import type { Commander } from 'cli'

import { resolve, toFileUrl } from '@std/path'
import { isZanixAppDefinition, type ZanixAppDefinition } from '@zanix/app'
import { SPACE_APP_MODULE } from 'commands/new/lib/tree/projects/space.ts'

/**
 * Imports `${root}/space.app.ts`'s default export as a `ZanixAppDefinition` — never
 * `${root}/mod.ts`. `mod.ts` calls `activateApps()`/`bootstrapServers()` (or `Zanix.start()` for
 * `space-server`) itself; importing it here would run a SECOND, unaware production boot alongside
 * whichever `zanix space` subcommand called this — two competing listeners for `dev`, a needless
 * server boot for `build` (which only ever needs the manifest's own `globalCss`/`pwa` config, read
 * back via `getGlobalCssPaths`/`getPwaConfig` after `defineSpaceApp` sets them eagerly — see
 * `defineSpaceApp`'s own doc in `@zanix/space`). `space.app.ts` holds the manifest alone
 * (`getSpaceAppTemplate`'s own doc in `commands/new/lib/tree/projects/space.ts`) specifically so
 * an orchestrator like `zanix space dev`/`zanix space build` can use it under its own conditions,
 * without either running a second boot.
 *
 * Shared between `zanix space dev` and `zanix space build` — a single source of truth for this
 * import, rather than two independently-maintained copies that could drift.
 */
export async function importSpaceApp(
  cwd: Commander,
  root: string,
): Promise<ZanixAppDefinition> {
  const path = resolve(root, SPACE_APP_MODULE)
  let imported: unknown
  try {
    imported = (await import(toFileUrl(path).href)).default
  } catch (error) {
    cwd.throw(
      new Error(
        `Could not import '${SPACE_APP_MODULE}' at '${path}': ${(error as Error).message}`,
      ),
    )
    // `cwd.throw` is typed `(e: Error) => never` — this line is unreachable for a real
    // `Commander`, which always throws — kept only as a defensive fallback for a caller that
    // passes a non-conforming stand-in whose own `throw` doesn't actually throw (e.g. a test
    // double), so this function never silently returns `undefined` as a `ZanixAppDefinition`.
    throw error
  }

  if (!isZanixAppDefinition(imported)) {
    const error = new Error(
      `'${SPACE_APP_MODULE}' must have a default export from defineSpaceApp() — see ` +
        `@zanix/space's own README for the expected shape.`,
    )
    cwd.throw(error)
    throw error
  }

  return imported
}
