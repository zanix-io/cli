import type { Commander } from 'cli'

import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers } from '@zanix/server'
import {
  broadcastClientCssChanged,
  broadcastSsrModuleChanged,
  createDevAssetHandler,
  createSpaceDevEngine,
  getDevRoutesReloader,
  setDevClientEnabled,
  setDevImportModule,
  spacePlugin,
} from '@zanix/space/dev'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'
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
async function spaceDevAction(this: Commander, options: { port?: number }) {
  assertProjectType(this, ['space', 'space-server'], 'space dev')

  const root = Deno.cwd()
  const spaceApp = await importSpaceApp(this, root)
  const appName = spaceApp.definition.name

  // Must be set BEFORE `activateApps` below — `defineSpaceApp`'s own `setup()` reads both
  // synchronously, in the same tick `activateApps` invokes it (see `dev-engine-registry.ts`'s own
  // doc in `@zanix/space` for the full reasoning).
  setDevClientEnabled(true)

  const port = options.port ?? 20202 // @zanix/server's own STATIC_PORT default for an 'ssr' server
  const engine = await createSpaceDevEngine({
    root,
    plugins: spacePlugin(),
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
  setDevImportModule(engine.ssrLoadModule)

  await activateApps([spaceApp])

  // `bootstrapServers`'s own return value (the created `ServerID[]`) is never needed here — this
  // command starts the listeners and returns; nothing here stops them, since exiting is the user's
  // own Ctrl+C, never something this command decides on its own.
  await bootstrapServers({
    ssr: { port, application: appName, preHandler: createDevAssetHandler(engine) },
    // `SpaceDevSocket`'s own `@Socket` decorator registers at import time (via this file's own
    // `@zanix/space/dev` import above), under the default Application — never `appName` — so this
    // must stay unanchored to the default Application too. Sharing `port` with `ssr` above is what
    // lets the browser connect same-origin (see `SpaceDevSocket`'s own doc, and
    // `docs/HANDLERS.md`'s "Sharing a port with an unanchored server" in `@zanix/server`).
    socket: { port },
  })

  self.addEventListener('unload', () => {
    engine.close()
  })

  logger.info(`zanix space dev running at http://localhost:${port} (project: '${appName}')`)
}

export default spaceDevAction

export function registerSpaceDevCommand(cwd: Commander): void {
  cwd.command('dev')
    .description(
      'Runs a @zanix/space project in dev mode: real file-watching HMR (SSR module ' +
        'invalidation, browser-facing asset transform, automatic reload) — never a substitute ' +
        "for `zanix build`/the project's own `start` task in production.",
    )
    .option('-p --port <port:number>', "The SSR server's port. Defaults to 20202.")
    .action((options) => spaceDevAction.call(cwd, options))
}
