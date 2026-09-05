import type { Commander } from 'cli'

import { resolve } from '@std/path'
import type { ZanixAppDefinition } from '@zanix/app'
import type * as ZanixAppModule from '@zanix/app'
import { SPACE_APP_MODULE } from 'commands/new/lib/tree/projects/space.ts'
import {
  importProjectDependency,
  importProjectModule,
} from 'commands/space/shared/import-project-module.ts'

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
 *
 * Uses {@linkcode importProjectModule} rather than a plain `import()` — `space.app.ts` belongs to
 * `root`, not to `@zanix/cli`, and its own bare specifiers (`@zanix/auth`, a package the project
 * imports only transitively through a relative import, ...) need to resolve against `root`'s own
 * `deno.json(c)`, including any `"links"` override it declares. See that function's own doc for
 * the full mechanism.
 */
export async function importSpaceApp(
  cwd: Commander,
  root: string,
): Promise<ZanixAppDefinition> {
  const path = resolve(root, SPACE_APP_MODULE)
  let imported: unknown
  try {
    imported = (await importProjectModule(path)).default
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

  // Resolved against THIS project's own config, exactly like `imported` above — never `@zanix/cli`'s
  // own native `@zanix/app`, which would check this `Symbol()` brand against a DIFFERENT `@zanix/app`
  // instance than whichever one `@zanix/space`'s own `defineSpaceApp` used to build `imported` (a
  // bare `Symbol()`, never `Symbol.for()`, only `===`-equal to itself within the SAME module
  // instance) — silently returning `false` here instead of a loud version-mismatch failure. See
  // `importProjectDependency`'s own doc for the full mechanism this avoids.
  const { isZanixAppDefinition } = await importProjectDependency(
    root,
    '@zanix/app',
  ) as typeof ZanixAppModule

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
