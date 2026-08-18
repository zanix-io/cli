import type { Commander } from 'cli'

import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers } from '@zanix/server'
import {
  broadcastClientCssChanged,
  broadcastSsrModuleChanged,
  createDevAssetHandler,
  createSpaceDevEngine,
  getActiveRenderer,
  getDevRoutesReloader,
  setDevClientEnabled,
  setDevImportModule,
  spacePlugin,
} from '@zanix/space/dev'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'
import {
  registerValidationOptions,
  type SpaceValidationOptions,
} from 'commands/space/shared/validation-flags.ts'
import { reportValidation } from 'commands/space/shared/report-validation.ts'
import { runDevValidation } from 'commands/space/dev/validation.ts'
import { assertRendererConsistency } from 'commands/space/shared/assert-renderer-consistency.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix space dev`'s real orchestration: imports the project's own `space.app.ts` manifest,
 * activates it under a `SpaceDevEngine` (real-time SSR module invalidation + browser-asset
 * transform — see `@zanix/space`'s own `modules/dev/mod.ts`), and serves it with the dev client
 * script/asset handler wired in. Everything this touches — `setDevClientEnabled`,
 * `setDevImportModule`, the `preHandler` hook — is dev-only, additive state that a plain
 * production boot (`deno run mod.ts`, this same project's own `start` task) never sets and never
 * needs to know exists; production efficiency/behavior is unaffected by this command's own
 * existence, only by actually running it.
 */
async function spaceDevAction(
  this: Commander,
  options: { port?: number } & SpaceValidationOptions,
) {
  assertProjectType(this, ['space', 'space-server'], 'space dev')

  const root = Deno.cwd()
  const spaceApp = await importSpaceApp(this, root)

  // Same guard `zanix space build` runs, for the same reason: a renderer mismatch between
  // `space.app.ts` and `compilerOptions.jsxImportSource` produces symptoms that never point at the
  // real cause, and dev is where a person is most likely to have just edited one of the two.
  assertRendererConsistency(this, root, getActiveRenderer())
  const appName = spaceApp.definition.name

  // Must be set before `bootstrapServers` below starts accepting real requests — `isDevClientEnabled()`
  // is read per-request (`render-page-react.tsx`/`render-page-preact.ts`/`not-found-handler.tsx` in
  // `@zanix/space`), not inside `setup()` itself; setting it this early just keeps every dev-only
  // flag flipped together, before anything downstream can observe a half-configured state.
  setDevClientEnabled(true)

  const port = options.port ?? 20202 // @zanix/server's own STATIC_PORT default for an 'ssr' server
  const engine = await createSpaceDevEngine({
    root,
    // `getActiveRenderer()` is already populated by now — `importSpaceApp()` above imports
    // `space.app.ts`, which runs `defineSpaceApp({ renderer })`'s own EAGER `setActiveRenderer`
    // call (see that function's own doc in `@zanix/space`) as soon as the module evaluates, well
    // before `activateApps()` below ever runs. Without this, a project declaring
    // `renderer: 'preact'` would silently get React's Vite plugin here regardless — confirmed as a
    // real, previously-unwired gap, not a hypothetical one.
    plugins: spacePlugin({ renderer: getActiveRenderer() }),
    // Matches this project's own scaffold convention (`getSpaceSrcTree`/`scanPageFiles`): every
    // page lives at `routes/**/page.tsx`, wherever `routesDir` itself is rooted.
    isRouteEntry: (id) => id.includes('/routes/') && id.endsWith('/page.tsx'),
    onSsrModuleChanged: (event) => {
      // Always re-run the reloader, never just when `affectedRoutes` is non-empty — a route file
      // itself changing needs this exactly as much as one of its own dependencies changing does;
      // `loadRoutes`' own dedup (comparing the freshly re-imported Target by identity) is what
      // makes this safe to call unconditionally on every SSR-affecting change.
      getDevRoutesReloader()?.()
        .then(() => broadcastSsrModuleChanged(event))
        .catch((error) => logger.error('Failed to reload routes after a file change', error))
    },
    onClientCssChanged: (urls) => broadcastClientCssChanged(urls),
  })
  // Must be set before `activateApps` below — `defineSpaceApp`'s own `setup()` reads
  // `getDevImportModule()` synchronously (via `loadRoutes`'s `importModule` option), in the same
  // tick `activateApps` invokes it.
  setDevImportModule(engine.ssrLoadModule)

  // Closes the already-created dev engine (Vite dev server + file watcher) if either step below
  // fails — without this, a failure here (e.g. a user `setup()` throwing, or the port already in
  // use) would leak the engine: nothing else ever calls `engine.close()` before this point, since
  // the `unload` listener that normally does is only registered once both steps below succeed.
  try {
    await activateApps([spaceApp])

    // AFTER activation, deliberately. Activation is what runs `loadRoutes()` and — for a
    // `renderer: 'preact'` project — registers that renderer's page renderer. Validating before it
    // would see no routes, and a render probe would render every page with the wrong renderer. This
    // is also why `zanix space build` cannot run the render phase at all: it never activates.
    const report = await runDevValidation(options, root)
    if (report) reportValidation(report)

    // `bootstrapServers`'s own return value (the created `ServerID[]`) is never needed here — this
    // command starts the listeners and returns; nothing here stops them, since exiting is the
    // user's own Ctrl+C, never something this command decides on its own.
    await bootstrapServers({
      ssr: {
        port,
        application: appName,
        preHandler: createDevAssetHandler(engine),
      },
      // `SpaceDevSocket`'s own `@Socket` decorator registers at import time (via this file's own
      // `@zanix/space/dev` import above), under the default Application — never `appName` — so
      // this must stay unanchored to the default Application too. Sharing `port` with `ssr` above
      // is what lets the browser connect same-origin (see `SpaceDevSocket`'s own doc, and
      // `docs/HANDLERS.md`'s "Sharing a port with an unanchored server" in `@zanix/server`).
      socket: { port },
    })
  } catch (error) {
    await engine.close()
    throw error
  }

  self.addEventListener('unload', () => {
    engine.close()
  })

  logger.info(
    `zanix space dev running at http://localhost:${port} (project: '${appName}')`,
  )
}

export default spaceDevAction

export function registerSpaceDevCommand(cwd: Commander): void {
  const command = cwd.command('dev')
    .description(
      'Runs a @zanix/space project in dev mode: real file-watching HMR (SSR module ' +
        'invalidation, browser-facing asset transform, automatic reload) — never a substitute ' +
        "for `zanix build`/the project's own `start` task in production.",
    )
    .option(
      '-p --port <port:number>',
      "The SSR server's port. Defaults to 20202.",
    )
  registerValidationOptions(command)
  command.action((options: { port?: number } & SpaceValidationOptions) =>
    spaceDevAction.call(cwd, options)
  )
}
