import type { Commander } from 'cli'
import type { SpaceDevOptions } from 'commands/space/dev/command.ts'

import {
  bootstrapServers,
  DEFAULT_APPLICATION,
  ProgramModule,
  webServerManager,
  ZANIX_SERVER_MODULES,
} from '@zanix/server'
import {
  broadcastClientCssChanged,
  broadcastClientModuleChanged,
  broadcastFullReloadNeeded,
  broadcastSsrModuleChanged,
  clientEntryPlugin,
  createDevAssetHandler,
  createSpaceDevEngine,
  createViteHotClientHandler,
  getActiveRenderer,
  getBootstrapSpaceAppConfig,
  getDevRoutesReloader,
  getUserPreHandler,
  setDevClientEnabled,
  setDevImportModule,
  spacePlugin,
} from '@zanix/space/dev'
import { getRoutesDir } from '@zanix/space'
import { dirname, resolve } from '@std/path'
import { assertProjectType, getCurrentProjectType } from 'commands/generate/shared/project.ts'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'
import {
  cleanupImportBatch,
  createImportBatchContext,
  importProjectModule,
  sweepStaleGeneratedModules,
} from 'commands/space/shared/import-project-module.ts'
import { collectFiles } from '@zanix/helpers'
import { SPACE_APP_MODULE } from 'commands/new/lib/tree/projects/space.ts'
import { reportValidation } from 'commands/space/shared/report-validation.ts'
import { runDevValidation } from 'commands/space/dev/validation.ts'
import { assertRendererConsistency } from 'commands/space/shared/assert-renderer-consistency.ts'
import { fixNpmSlashSpecifierPlugin } from 'commands/space/build/lib/plugins/fix-npm-slash-specifier.ts'
import logger from '@zanix/utils/logger'

/**
 * Watches `space.app.ts` itself for a change and, on the first one, restarts the WHOLE `zanix
 * space dev` process — never a partial/in-place reload. `space.app.ts` is never part of Vite's own
 * module graph (`importSpaceApp` above runs a plain native `import()` before
 * `createSpaceDevEngine()` is even constructed — see that function's own doc), so Vite's HMR has
 * no mechanical way to see this file change at all; this is an entirely separate watcher, using
 * `Deno.watchFs` directly, not Vite's.
 *
 * A full process restart, not an in-process re-import, because `space.app.ts`'s own config
 * (`renderer`, `routesDir`, `sitemap`, `messagesDir`, `assetsDir`, ...) is captured EAGERLY into
 * `@zanix/space`'s own module-level registries the moment it's imported — safely re-overwritable
 * on their own (each is a plain `set*` call), but `defineSpaceApp({ globalCss })`'s own
 * `addGlobalCssPaths` is ADDITIVE (confirmed in `css-manifest.ts`), so a second in-process import
 * would silently duplicate every `globalCss` entry. A fresh OS process sidesteps this (and any
 * similar accumulator this package might add later) entirely, with a clean module cache — the
 * same reasoning Vite itself applies to its own `vite.config.ts` changing: a full restart, never
 * partial HMR, because a config file's own side effects aren't safely re-orderable in place.
 *
 * Re-execs via `Deno.mainModule`/`Deno.args` (this process's own entry point and subcommand
 * arguments) rather than trying to reconstruct the exact original `deno run` invocation's
 * permission/`--config` flags — `-A` matches the one convention every real `zanix` invocation
 * already uses (the installed CLI binary's own generated shim), and omitting `--config` lets Deno
 * auto-discover `cli`'s own real `deno.jsonc` by walking up from `Deno.mainModule`, which is what
 * a plain `deno run` invocation (not through the installed shim) already relies on anyway.
 *
 * @param spaceAppPath - Absolute path to the project's own `space.app.ts`.
 * @param onRestart - Async cleanup to run BEFORE respawning (closing the dev engine, stopping the
 * currently-running servers) — awaited fully before the new process is spawned and this one exits,
 * so the old and new processes never both hold the same port at once.
 */
export function watchSpaceAppFile(spaceAppPath: string, onRestart: () => Promise<void>): void {
  let restarting = false
  ;(async () => {
    for await (const event of Deno.watchFs(spaceAppPath)) {
      if (restarting) return
      if (event.kind !== 'modify' && event.kind !== 'create') continue
      restarting = true

      logger.info(`${SPACE_APP_MODULE} changed — restarting zanix space dev...`)
      try {
        await onRestart()
        new Deno.Command(Deno.execPath(), {
          args: ['run', '-A', Deno.mainModule, ...Deno.args],
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        }).spawn()
        Deno.exit(0)
      } catch (error) {
        logger.error(`Failed to restart after a ${SPACE_APP_MODULE} change`, error)
        Deno.exit(1)
      }
      return
    }
  })().catch((error) => logger.error(`Watching ${SPACE_APP_MODULE} for changes failed`, error))
}

/**
 * `zanix space dev`'s real orchestration: imports the project's own `space.app.ts` manifest,
 * activates it under a `SpaceDevEngine` (real-time SSR module invalidation + browser-asset
 * transform — see `@zanix/space`'s own `modules/dev/mod.ts`), and serves it with the dev client
 * script/asset handler wired in. Everything this touches — `setDevClientEnabled`,
 * `setDevImportModule`, the `preHandler` hook — is dev-only, additive state that a plain
 * production boot (`deno run mod.ts`, this same project's own `start` task) never sets and never
 * needs to know exists; production efficiency/behavior is unaffected by this command's own
 * existence, only by actually running it. Two exceptions, both READ (never owned) state a
 * consumer's own `space.app.ts` (or anything it imports) may have registered:
 * - `getUserPreHandler()` — set via `definePreHandler()` — composed AFTER this command's own
 *   Vite/asset handling, so a consumer's `preHandler` (e.g. `langPreHandler`) behaves identically
 *   under `zanix space dev` and production, instead of only ever working in the latter.
 * - `getBootstrapSpaceAppConfig().server` — set via `defineBootstrapSpaceAppConfig()` — spread
 *   into `bootstrapServers` BEFORE `rest`/`ssr` below (never `socket`, which stays entirely
 *   dev-owned — `SpaceDevSocket` has no registrable config of its own). `rest`/`ssr`'s own
 *   dev-owned fields (`port`, `application`, and for `ssr` also `preHandler`/`onCreate`) are
 *   assigned AFTER the spread, so those specific fields always win — a consumer's config can add
 *   `graphql`, or `onError`/`attachRequestToErrors` on `ssr` (e.g. `createNotFoundHandler()`,
 *   every generated `space.app.ts` registers this — see `getSpaceAppTemplate`'s own doc,
 *   `@zanix/cli`), never override dev's own port/application/preHandler/module-invalidation
 *   wiring. Same reasoning as `getUserPreHandler()`: without the `rest` half of this, `rest` (and
 *   `POST /api/log`, which `defineSpaceApp` always registers on it) would be invisible under
 *   `zanix space dev`, only ever reachable from a production `mod.ts`'s own `bootstrapRemoteApp`
 *   call. The `ssr` half covers the SAME class of silent drop for `onError`/`attachRequestToErrors`
 *   — direct inspection confirms this object reaches `bootstrapServers({ ssr })` intact under
 *   `zanix space dev`, exactly as it does in production. Whether `@zanix/server`'s own dev-mode
 *   dispatch actually INVOKES a registered `onError` for a route that matches nothing at all
 *   (`SpaceDevEngine`'s own request handling, not this command's own concern) is a separate,
 *   deeper question this doesn't itself answer — see `@zanix/space`'s own
 *   `not-found-integration.test.tsx` for that guarantee against a direct `bootstrapServers()` call,
 *   outside `zanix space dev` entirely.
 *
 * `watchSpaceAppFile` (above) is the THIRD read-only exception to the same "dev-only, additive
 * state" rule — a change to `space.app.ts` itself restarts this whole process (see that function's
 * own doc for why a full restart, never a partial reload).
 *
 * When the project has a `gql/` directory, this command ALSO runs the GraphQL query/mutation check
 * once, at boot, after `activateApps` (`runGraphqlCheck`, `commands/space/shared/graphql-check.ts`)
 * — `--no-graphql-check` opts out. Unlike document validation above, a failure here never fails this
 * command: it only logs, the same "report, never crash the dev server" shape.
 *
 * This whole module (`action.ts`) is itself only ever reached via `command.ts`'s own non-literal
 * `await import(...)` — `commands/mod.ts` eagerly imports every command's own module just to
 * REGISTER its CLI surface, regardless of which command a user actually runs, so a static
 * top-level import of `@zanix/server`/`@zanix/space/dev` here would make EVERY `zanix` invocation
 * pay for resolving their module graphs (the real, live Vite/SSR dev bridge, in `@zanix/space/dev`'s
 * case), not just `zanix space dev`. `@zanix/app/runtime` stays dynamic, INSIDE this function, for
 * the identical reason, one layer further in:
 * `activateApps` is only needed after `createSpaceDevEngine`/`importSpaceApp` above have already
 * run, so there's no reason to resolve it any earlier even within this already-lazy module.
 */
async function spaceDevAction(
  this: Commander,
  options: SpaceDevOptions,
) {
  assertProjectType(this, ['space', 'space-server'], 'space dev')

  const root = Deno.cwd()
  // Before anything else touches this project's own tree — a killed earlier `zanix space dev`/
  // `build` session (Ctrl+C, a crash) can leave a `.zanix-import-*.js` temp file behind (see
  // `sweepStaleGeneratedModules`'s own doc for why nothing legitimate ever survives to a LATER,
  // separate invocation); this sweep is what actually reclaims it, since nothing else ever revisits
  // an orphan a random UUID names uniquely.
  await sweepStaleGeneratedModules(root)
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
  // Assigned via the `ssr` server's own `onCreate` below — read lazily inside `onSsrModuleChanged`
  // (only ever invoked well after that point, on a later file change), never at closure-creation
  // time, since the engine (and this callback) must exist before the SSR server is even created.
  // Deliberately only the `ssr` id, never `socket`'s: `loadRoutes()` only ever affects PAGE routes,
  // which live exclusively on the `ssr` server — `SpaceDevSocket`'s own single route is registered
  // once, at import time, and never changes when a page file is added/renamed/removed. Refreshing
  // it anyway would recompile its handler from whatever `ProgramModule.routes.getRoutes('socket')`
  // holds at that moment, which throws once nothing is currently mid-registration for that type.
  let ssrServerId: string | undefined
  // Assigned inside the `try` block below, once `bootstrapServers` actually resolves — declared
  // here so `watchSpaceAppFile`'s own restart cleanup (after the `try`/`catch`) can still reach it.
  let servers: Awaited<ReturnType<typeof bootstrapServers>> | undefined

  const engine = await createSpaceDevEngine({
    root,
    // `getActiveRenderer()` is already populated by now — `importSpaceApp()` above imports
    // `space.app.ts`, which runs `defineSpaceApp({ renderer })`'s own EAGER `setActiveRenderer`
    // call (see that function's own doc in `@zanix/space`) as soon as the module evaluates, well
    // before `activateApps()` below ever runs. Without this, a project declaring
    // `renderer: 'preact'` would silently get React's Vite plugin here regardless.
    // `clientEntryPlugin`'s own `enforce: 'pre'` is what lets it answer the auto-generated client
    // entry's virtual id ahead of `deno()`'s own resolver (which otherwise claims it first, and
    // fails "not found" — confirmed empirically, see that plugin's own doc); without this, every
    // full-document response's own bootstrap `<script>` 500s the moment a real browser requests it.
    plugins: [
      ...spacePlugin({ renderer: getActiveRenderer() }),
      clientEntryPlugin({ renderer: getActiveRenderer() }),
      // See `fixNpmSlashSpecifierPlugin`'s own doc: a real, confirmed `@deno/vite-plugin` bug
      // (an HTTPS-referrer-resolved bare npm import gets serialized with an erroneous leading
      // slash, `npm:/<pkg>` instead of `npm:<pkg>`), not this command's own — worked around here
      // rather than left to break every real consumer's client bundle under `zanix space dev` too.
      fixNpmSlashSpecifierPlugin(),
    ],
    // Matches this project's own scaffold convention (`getSpaceSrcTree`/`scanPageFiles`): every
    // page lives at `routes/**/page.tsx`, wherever `routesDir` itself is rooted.
    isRouteEntry: (id) => id.includes('/routes/') && id.endsWith('/page.tsx'),
    onSsrModuleChanged: (event) => {
      // Always re-run the reloader, never just when `affectedRoutes` is non-empty — a route file
      // itself changing needs this exactly as much as one of its own dependencies changing does;
      // `loadRoutes`' own dedup (comparing the freshly re-imported Target by identity) is what
      // makes this safe to call unconditionally on every SSR-affecting change.
      //
      // `loadRoutes()` (inside the reloader) only re-populates `ProgramModule`'s own route
      // registry — it never reaches the SSR server's already-`create()`d handler, which
      // `getMainHandler` compiled once, at boot, from whatever the registry held THEN (see
      // `WebServerManager.refreshRoutes`'s own doc). Without this, adding/renaming/removing a
      // route file leaves the registry correctly updated while the live server keeps 404ing (or
      // serving a stale path) for it until the whole process restarts.
      const routesReloader = getDevRoutesReloader()
      if (!routesReloader) return

      // `event.isComet` — a Comet's own edit never adds/removes/renames a route, so ONLY the
      // page(s) it's reachable from (`event.affectedRoutes`, already computed by
      // `computeAffectedRoutes`) need reimporting — see `LoadRoutesOptions.onlyFilePaths`'s own
      // doc. Every other change (the route file itself, a shared non-Comet dependency, ...) keeps
      // the normal, unscoped call: it may legitimately be a structural change (a page renamed
      // away), which only a full, unscoped `loadRoutes()` pass detects correctly (the
      // orphan-cleanup sweep).
      routesReloader(event.isComet ? event.affectedRoutes : undefined)
        .then(() => ssrServerId && webServerManager.refreshRoutes(ssrServerId))
        .then(() => {
          // `event.isComet` — a Comet is reachable from the `ssr` environment's own module graph
          // too (its initial HTML is still server-rendered), so editing one fires this callback
          // exactly the same as editing the route file itself would. The route registry/dispatch
          // table above still needs refreshing either way (so the NEXT real, fresh request
          // reflects the edit) — but broadcasting THIS event specifically is what makes a
          // connected browser's own `handleSsrModuleChanged` call `location.reload()` (see that
          // function's own doc, `dev-client-script.ts`), discarding whatever client-only state
          // (a Comet's own `useState`, a form draft) it was holding. A pure Comet edit already
          // reported its own `client-module-changed` update separately (`onClientModuleChanged`
          // below) — that alone brings the connected page up to date via Fast Refresh, with no
          // reload and no lost state, so broadcasting the reload-triggering event on top of it
          // would only ever make things WORSE, never necessary.
          if (event.isComet) return
          broadcastSsrModuleChanged(event)
        })
        .catch((error) => logger.error('Failed to reload routes after a file change', error))
    },
    onClientCssChanged: (urls) => broadcastClientCssChanged(urls),
    // Required, not optional: `SpaceDevEngine` reports every edited Comet script
    // (`onClientModuleChanged`'s own doc, `@zanix/space/dev`) and the browser side
    // (`dev-client-script.ts`'s `handleClientModuleChanged`, wired through `dev-vite-hot-client.ts`'s
    // `/@vite/client` replacement) already knows how to apply it via Fast Refresh/`@prefresh/vite`
    // with no reload — but with no `onClientModuleChanged` callback here, `ssrHotUpdatePlugin`
    // silently drops every such change (see that plugin's own doc), so a Comet's own edit would
    // never reach a connected browser at all; only a manual reload would pick it up.
    onClientModuleChanged: (urls) => broadcastClientModuleChanged(urls),
    // Relays Vite's OWN internal "a full reload is needed" signal (dep-optimizer re-run mid-
    // session, among other real Vite-internal triggers) — see `onFullReloadNeeded`'s own doc in
    // `@zanix/space` for the real, confirmed incident this closes (a duplicate module instance of
    // `@prefresh/core` silently breaking Preact Fast-Refresh with no error at all).
    onFullReloadNeeded: () => broadcastFullReloadNeeded(),
  })
  // Must be set before `activateApps` below — `defineSpaceApp`'s own `setup()` reads
  // `getDevImportModule()` synchronously (via `loadRoutes`'s `importModule` option), in the same
  // tick `activateApps` invokes it.
  setDevImportModule(engine.ssrLoadModule)

  // Closes the already-created dev engine (Vite dev server + file watcher) if any step below
  // fails — without this, a failure here (e.g. a user `setup()` throwing, or the port already in
  // use) would leak the engine: nothing else ever calls `engine.close()` before this point, since
  // the `unload` listener that normally does is only registered once every step below succeeds.
  try {
    // A `space-server` project's real `mod.ts` calls `Zanix.start({ apps })` (`@zanix/core`),
    // which — BEFORE `activateApps` — always runs `defineCoreMetadata()` (registers
    // `@zanix/datamaster`/`@zanix/auth`/`@zanix/notifications`/`@zanix/asyncmq`'s own core
    // connector/provider slots) and auto-discovers this project's own `src/server/`
    // handlers/interactors/connectors/providers/`.defs.ts` files (`defineLocalMetadata`). This
    // command never imports `mod.ts` at all (see `importSpaceApp`'s own doc for why — a second,
    // unaware production boot racing this one), and drops to `activateApps`/`bootstrapServers`
    // directly instead of `Zanix.start()` for the fine-grained control its own dev-only
    // `preHandler`/`onCreate`/shared-port/`finalize: false` wiring below needs, which `start()`'s
    // own higher-level wrapper doesn't expose. In doing so, it never picked up either registration
    // step — a real, confirmed gap: a route/Interactor resolving a core connector (`this.database`,
    // ...) or a project-local provider/handler under `src/server/` throws `Missing core connector
    // slot`/behaves as if the file were never imported at all, purely because `zanix space dev`
    // itself never ran, even though the identical project boots correctly via its own `mod.ts`.
    // Only for `space-server`: a pure `space` project has no `src/server/` tree and no reason to
    // resolve `@zanix/core` (and transitively `@zanix/datamaster`/`@zanix/auth`/
    // `@zanix/notifications`/`@zanix/asyncmq`) at all — matching
    // `PROJECT_TYPE_DEPENDENCIES['space']`'s own reasoning for never declaring it a dependency.
    //
    // `Zanix.compose(rootDir)` — the PUBLIC, side-effect-scoped subset of `start()` built for
    // exactly the two registration steps above, with NO server started and `apps` composition
    // deliberately excluded (see `compose`'s own doc, `@zanix/core`) — is deliberately NOT called
    // with this project's own real `root` directly: its own `defineLocalMetadata(rootDir)` half
    // does a PLAIN, un-rewritten native `import()` of every discovered `src/server/` file, which
    // would resolve THEIR bare specifiers against `cli`'s OWN config, never the project's — the
    // identical class of bug `importProjectModule` exists to fix, unrewritten here since
    // `compose()`'s own internal scan never goes through it (a real `mod.ts` calling `compose()`/
    // `start()` never hits this: that process's OWN governing config already IS the project's, no
    // rewriting needed). Worse than a silent wrong resolution: `defineLocalMetadata`'s own
    // `Promise.all` rejects the WHOLE call the instant any ONE discovered file fails to resolve a
    // bare specifier `cli` doesn't happen to declare (`@zanix/validator`, near-universal for RTOs,
    // confirmed absent from `cli`'s own `deno.jsonc`) — turning "some connector lookups fail" into
    // "`zanix space dev` refuses to boot at all" for most real `space-server` projects.
    //
    // Worked around by pointing `compose()`'s own scan at a genuinely empty, real directory (a
    // harmless no-op for `defineLocalMetadata` — `defineCoreMetadata()` still runs for real,
    // unaffected: its own four imports are fully-qualified `jsr:` specifiers, always resolving
    // correctly regardless of which config governs this process) and doing the REAL `src/server/`
    // scan ourselves, right below, through `importProjectModule` instead — same registration
    // effect, project-aware resolution. `ImportBatchContext` (a SHARED dedup cache across every
    // discovered file, not one fresh cache per file) is required, not optional, here — see that
    // type's own doc for the real identity split calling `importProjectModule` once per file
    // INDEPENDENTLY would silently reintroduce for any two files that relatively import each other
    // (the normal shape a handler resolving `this.interactors.get(SomeInteractor)` needs).
    if (getCurrentProjectType(root) === 'space-server') {
      const { default: Zanix } = await import('@zanix/core')
      const emptyScanDir = await Deno.makeTempDir({ prefix: 'zanix-space-dev-empty-scan-' })
      try {
        await Zanix.compose(emptyScanDir)
      } finally {
        // Recursive: `compose()`'s own scan is a black box from here — if it ever writes anything
        // into this throwaway directory, a non-recursive remove would throw and (being swallowed
        // below) leak the directory on every boot instead of actually cleaning it up.
        await Deno.remove(emptyScanDir, { recursive: true }).catch(() => {})
      }

      // Mirrors `defineLocalMetadata`'s own `DEFAULT_APPLICATION` scoping (`@zanix/core`,
      // `utils/metadata.ts`) — a real `mod.ts`'s own `Zanix.start({ apps })` registers
      // `src/server/`'s handlers under `DEFAULT_APPLICATION` ('main'), never the Space app's own
      // named Application; matching that here is what keeps a generated REST route reachable the
      // same way it would be under a real production boot.
      await ProgramModule.defineApplication(DEFAULT_APPLICATION, async () => {
        const files: string[] = []
        collectFiles(root, ZANIX_SERVER_MODULES, (path) => files.push(path))
        const batch = createImportBatchContext()
        try {
          // `Promise.allSettled`, not `Promise.all` — `ImportBatchContext`'s own contract requires
          // `cleanupImportBatch` to run only after EVERY call sharing `batch` has settled (see that
          // type's own doc). `Promise.all` rejects the instant the FIRST entry rejects, which would
          // run cleanup in the `finally` below while sibling calls are still mid-flight — deleting
          // a temp file another call is about to `await import()` from, or racing its own
          // in-progress write to one.
          const results = await Promise.allSettled(
            files.map((path) => importProjectModule(path, batch)),
          )
          const failed = results.find((result) => result.status === 'rejected')
          if (failed) throw (failed as PromiseRejectedResult).reason
        } finally {
          await cleanupImportBatch(batch)
        }
      })
    }

    const { activateApps } = await import('@zanix/app/runtime')
    await activateApps([spaceApp])

    // AFTER activation, deliberately. Activation is what runs `loadRoutes()` and — for a
    // `renderer: 'preact'` project — registers that renderer's page renderer. Validating before it
    // would see no routes, and a render probe would render every page with the wrong renderer. This
    // is also why `zanix space build` cannot run the render phase at all: it never activates.
    const report = await runDevValidation(options)
    if (report) reportValidation(report)

    // Same "opt-out, on by default when the feature is configured" shape as document validation
    // above — runs once, at boot, never re-run per file change (same cadence `runDevValidation`
    // itself already uses). A real query/schema mismatch never fails the dev server:
    // `reportGraphqlCheckFailures`/`reportGraphqlCheckWarnings` only log — see `graphql-check.ts`'s
    // own doc for exactly how Layer 2 discovers a locally compiled schema (a real, separate `deno
    // run` subprocess, rooted at this project, independent of whatever this dev server itself
    // boots). That subprocess failing outright (an unsupported `@zanix/core`/`@zanix/server`, or a
    // real error thrown while importing one of the project's own decorated files) still surfaces as
    // a thrown `Error` here, same as any other real boot failure this function doesn't swallow.
    if (options.graphqlCheck !== false) {
      const { runGraphqlCheck, reportGraphqlCheckFailures, reportGraphqlCheckWarnings } =
        await import('commands/space/shared/graphql-check.ts')
      // Same "only the first root" choice `zanix space build` makes — see that command's own
      // comment for why.
      const primaryRoutesDir = [getRoutesDir()].flat()[0]
      const graphqlResult = await runGraphqlCheck(root, dirname(resolve(root, primaryRoutesDir)))
      reportGraphqlCheckWarnings(graphqlResult)
      reportGraphqlCheckFailures(graphqlResult)
    }

    // This command still never stops these servers itself; exiting is the user's own Ctrl+C, never
    // something this command decides.
    // `createViteHotClientHandler()` must be tried FIRST, ahead of `createDevAssetHandler` — both
    // recognize `/@vite/client` (`looksLikeDevAssetRequest`'s own `VITE_SPECIAL_PREFIXES` includes
    // the `/@vite/` prefix), but only the hand-written one defines `window.__spaceApplyClientUpdate`
    // (see `dev-vite-hot-client.ts`'s own doc). Without this ahead of it, `createDevAssetHandler`
    // wins that request and forwards it to Vite's own REAL client bundle instead — which never
    // defines that global, so `dev-client-script.ts`'s `handleClientModuleChanged` silently no-ops
    // for every Comet edit, with no error to point at why.
    const viteHotClientHandler = createViteHotClientHandler()
    const devAssetHandler = createDevAssetHandler(engine)
    // Tried LAST, after both of this dev server's own handlers above — a consumer's own
    // `preHandler` (e.g. `langPreHandler`, registered via `definePreHandler()` from anything
    // `space.app.ts` imports) must never get a chance to intercept `/@vite/client` or a
    // dev-transformed asset request; those two always win first. Without this call here, a
    // consumer's `preHandler` would be invisible under `zanix space dev` entirely — it would only
    // ever reach a production `mod.ts`'s own `bootstrapRemoteApp` call, which `zanix space dev`
    // never imports (see `getUserPreHandler`'s own doc, `@zanix/space`).
    const userPreHandler = getUserPreHandler()
    const bootstrapConfig = getBootstrapSpaceAppConfig()
    // `bootstrapConfig.server` spread FIRST, `rest`/`ssr`/`socket` assigned AFTER — so whatever a
    // consumer registered via `defineBootstrapSpaceAppConfig` (a custom `graphql`, ...) flows
    // through here exactly as it would in production, while `rest`/`ssr`/`socket` stay entirely
    // dev-owned. `rest.port` in particular is forced to the SAME shared `port` as `ssr`/`socket`
    // below, never left to a consumer's own `rest.port` (or `@zanix/server`'s own unrelated
    // default): the browser's own `/api/log` POST (`client-logger.ts`'s `postLog`) is a relative
    // fetch resolved against the PAGE's own origin, so a `rest` server listening on any OTHER port
    // is completely unreachable from it regardless of whether it started successfully. Without this,
    // `rest` (and `POST /api/log`, which `defineSpaceApp` always registers on it) would never be
    // REACHABLE under `zanix space dev` even though the server itself is running — same "dev and
    // prod both read the same registration" parity `getUserPreHandler()` already established for
    // `preHandler`; production's own equivalent, `bootstrapRemoteApp(spaceApp,
    // getBootstrapSpaceAppConfig())` (`space.ts`'s own `getSpaceModTemplate`), needs no equivalent
    // `port` override at all, since a standalone production app has no OTHER port to conflict with.
    servers = await bootstrapServers({
      ...bootstrapConfig.server,
      // `application: appName` — same anchoring `ssr` below already needs, for the same reason:
      // `createLogApiController` (registered inside `defineSpaceApp`'s own `setup()`, itself run
      // FOR `spaceApp` by `activateApps([spaceApp])` above) registers its route under the ACTIVE
      // application `activateApps` establishes for the app being activated — `appName`, not the
      // default `'main'` a `rest` config with no `application` at all resolves to. Without this,
      // `rest` finds zero routes (`hasRoutesForScope('rest', 'main')` empty), so
      // `bootstrapServers`'s own `shouldServeType`/`hasRoutesForScope` combo never starts a rest
      // server at all — no error, just silently never listening, `/api/log` unreachable. Unlike
      // `socket` below, which stays deliberately unanchored (`SpaceDevSocket` really does register
      // under the default Application).
      //
      // `onError`/`attachRequestToErrors` duplicated here from `bootstrapConfig.server?.ssr` (never
      // moved OUT of `ssr` below — a consumer registering them there must keep working when ports
      // AREN'T forced to share, e.g. a future non-dev-mode caller of this same config): `@zanix/server`
      // registers server types in a fixed order (`rest` → `socket` → `graphql` → `ssr`) and, when
      // multiple types share one port, only the FIRST to bind it actually calls `Deno.serve()` —
      // every later type sharing that port just reuses the address, and NONE of its own `opts`
      // (`onError` included) ever reach the real listener. `rest` always wins the shared `port` this
      // block forces below, so `rest`'s own `onError` is the one that actually answers EVERY
      // request on it, `ssr`'s pages included — without this duplication, a registered
      // `onError: createNotFoundHandler()` (every generated `space.app.ts` sets this, see
      // `getSpaceAppTemplate`'s own doc) would be silently never invoked for an unmatched SSR route
      // under `zanix space dev`, even though the exact same registration works in production (where
      // `ssr` never shares a port with anything, so this ordering quirk never applies).
      rest: {
        ...bootstrapConfig.server?.rest,
        onError: bootstrapConfig.server?.rest?.onError ?? bootstrapConfig.server?.ssr?.onError,
        attachRequestToErrors: bootstrapConfig.server?.rest?.attachRequestToErrors ??
          bootstrapConfig.server?.ssr?.attachRequestToErrors,
        port,
        application: appName,
      },
      ssr: {
        ...bootstrapConfig.server?.ssr,
        port,
        application: appName,
        // Must stay `async`/`await` the asset handler explicitly — `devAssetHandler` returns a
        // `Promise<Response | null>`, and a bare `??` chain never treats a pending Promise object
        // as nullish (it's always a truthy reference, whatever it eventually resolves to), so
        // `devAssetHandler(req) ?? userPreHandler?.(req, info)` would NEVER reach `userPreHandler`
        // regardless of what `devAssetHandler` resolves to (see `command-live-boot-prehandler.test.ts`,
        // the regression check guarding this).
        preHandler: async (req, info) =>
          viteHotClientHandler(req) ?? await devAssetHandler(req) ?? userPreHandler?.(req, info),
        // Captures the `ssr` server's own id specifically — see `ssrServerId`'s own doc above for
        // why `onSsrModuleChanged` must target only this server, never `socket`'s.
        onCreate: (id) => ssrServerId = id,
      },
      // `SpaceDevSocket`'s own `@Socket` decorator registers at import time (via this file's own
      // `@zanix/space/dev` import above), under the default Application — never `appName` — so
      // this must stay unanchored to the default Application too. Sharing `port` with `ssr` above
      // is what lets the browser connect same-origin (see `SpaceDevSocket`'s own doc, and
      // `docs/handlers.md`'s "Sharing a port with an unanchored server" in `@zanix/server`).
      socket: { port },
    }, {
      // `finalize: false` — a normal (non-dev) boot lets this wipe `ProgramModule`'s own route
      // registry right after start, since a plain process never reads it again (`getMainHandler`
      // already compiled each server's dispatch table from it). This process is different: every
      // later file change re-enters `loadRoutes()` (via the reloader above) and `refreshRoutes()`
      // recompiles the `ssr` server's own table FROM that same registry — see
      // `WebServerManager.refreshRoutes`'s own doc. Finalizing here would wipe it the instant this
      // very call returns, so the very first post-boot reload would only ever see whichever page(s)
      // actually got reimported that cycle, silently losing every route `loadRoutes()` correctly
      // left untouched (a cache-hit, unchanged file skips re-registering by design — see
      // `loadRoutes`'s own doc) instead of leaving its still-correct previous registration in place.
      finalize: false,
    })
  } catch (error) {
    await engine.close()
    throw error
  }

  self.addEventListener('unload', () => {
    engine.close()
  })

  // See `watchSpaceAppFile`'s own doc for why this is a full-process restart, entirely separate
  // from Vite's own HMR above.
  watchSpaceAppFile(resolve(root, SPACE_APP_MODULE), async () => {
    if (servers) await webServerManager.stop(servers)
    await engine.close()
  })

  logger.info(`Zanix space dev running at http://localhost:${port}`)
}

export default spaceDevAction
