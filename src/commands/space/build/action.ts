import type { Commander } from 'cli'
import type { SpaceBuildOptions } from 'commands/space/build/command.ts'
import type { CompileTreeResult } from 'commands/space/shared/compile-messages.ts'

import { assertProjectType } from 'commands/generate/shared/project.ts'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'
import {
  importProjectModule,
  sweepStaleGeneratedModules,
} from 'commands/space/shared/import-project-module.ts'
import { toValidationFlags } from 'commands/space/shared/validation-flags.ts'
import {
  failOnBlockingDiagnostics,
  reportValidation,
} from 'commands/space/shared/report-validation.ts'
import { assertRendererConsistency } from 'commands/space/shared/assert-renderer-consistency.ts'
import { fixNpmSlashSpecifierPlugin } from 'commands/space/build/lib/plugins/fix-npm-slash-specifier.ts'
import { obfuscateFile } from 'commands/build/lib/obfuscate.ts'
import { requestForceExit } from 'utils/force-exit.ts'
import { dirname, resolve } from '@std/path'
import logger from '@zanix/utils/logger'

/**
 * `zanix space build`'s real orchestration: imports the project's own `space.app.ts` manifest
 * (same as `zanix space dev` — never `mod.ts`, see `importSpaceApp`'s own doc for why), reads back
 * its declared `globalCss`/`pwa` (`getGlobalCssPaths`/`getPwaConfig`, both set eagerly by
 * `defineSpaceApp` at import time), and builds the real, production CLIENT bundle via
 * `@zanix/space/vite`'s `buildSpaceClient` — comets, CSS, PWA icons/service worker, and their
 * manifests. `pwa` is passed straight through unchanged: `PwaConfig` (what `defineSpaceApp({ pwa
 * })` already takes) IS `buildSpaceClient`'s own `pwa` option shape — no separate plugin
 * configuration needed here at all (see `PwaConfig`'s own doc in `@zanix/space` for the full
 * design). `renderer`/`routesDir` are NOT read back explicitly here, unlike `globalCss`/`pwa` —
 * neither needs to be: `buildSpaceClient`'s own `renderer`/`routesDir` options already default to
 * `getActiveRenderer()`/`getRoutesDir()` internally (the same eager flags `defineSpaceApp({
 * renderer, routesDir })` populate), so this command gets the right renderer's Vite plugin and
 * locates the project's own pages automatically, purely from having already imported
 * `space.app.ts` above. Obfuscation (`--obfuscate`) runs as a separate post-processing pass over every built
 * `.js` file (comet chunks AND the generated service worker) — the exact same
 * `javascript-obfuscator` config `zanix build`'s own `compileAndObfuscate` already uses
 * (`obfuscateFile`, `commands/build/lib/obfuscate.ts`) — one shared obfuscation behavior, not two
 * independently-tuned ones.
 *
 * Deliberately does NOT build the SSR/server side — production SSR keeps running directly against
 * source via this project's own `start` task (`deno run mod.ts`), unaffected by this command's own
 * existence. See `buildSpaceClient`'s own doc for the full reasoning and the `--bundle-server`
 * possibility this leaves open for later, should a concrete need arise.
 *
 * One real exception to "SSR-facing content is out of scope here": when the project declares
 * `defineSpaceApp({ messagesDir })`, this command ALSO compiles that directory's ICU catalogs to
 * AST, under `{outDir}/messages/` (`writeCompiledMessagesTree`,
 * `commands/space/shared/compile-messages.ts`) — `--no-messages` opts out, same convention as
 * `--no-minify`. This isn't "building the server": it's the SSR-facing counterpart to the client
 * manifests `buildSpaceClient` already writes into that same `outDir` — `messagesDir` itself, the
 * developer's own hand-authored ICU source, is never touched (see that compiler's own doc): writing
 * into it in place would corrupt a developer's real working copy on an ordinary local build. A
 * compile failure fails the WHOLE
 * build before anything else runs (`assertNoCompileFailures`, inside `writeCompiledMessagesTree`
 * itself) — never a build that "succeeds" while quietly leaving a broken message catalog on disk.
 *
 * A second, unrelated exception, same "opt-out, on by default" shape: when the project has a `gql/`
 * directory, this command ALSO runs the GraphQL query/mutation check
 * (`runGraphqlCheck`/`assertNoGraphqlCheckFailures`, `commands/space/shared/graphql-check.ts`)
 * before the client build — `--no-graphql-check` opts out. See that module's own doc for exactly
 * what the check covers (including the real subprocess it spawns to discover a locally compiled
 * schema, for a project that has one) and the real limitations that remain.
 *
 * `@zanix/space`/`@zanix/space/vite` are imported dynamically, INSIDE this function, never as a
 * static top-level import — this whole module (`action.ts`) is itself only ever reached via
 * `command.ts`'s own non-literal `await import(...)`, so a static import here costs nothing extra
 * once that boundary already exists — kept dynamic anyway, for the same real reason:
 * `@zanix/space/vite`'s entire dependency graph (Vite,
 * React, Tailwind, `sharp`, vanilla-extract, ...) has no business loading before it's actually
 * needed even within a single `zanix space build` run (`getGlobalCssPaths`/`getPwaConfig` need
 * `@zanix/space` resolved first, before `@zanix/space/vite`'s own heavier graph is worth paying
 * for). `writeCompiledMessagesTree` (`commands/space/shared/compile-messages.ts`) is imported the
 * same lazy way, for the same reason — it pulls in `@formatjs/icu-messageformat-parser`, which no
 * `zanix` invocation outside `space build` (with a `messagesDir` actually configured) should ever
 * load. `importSpaceApp`'s own bare `@zanix/app` import (this file's own top-level import above)
 * is a REAL, unavoidably-static edge for `action.ts`'s own module graph — but since this whole file
 * only resolves once `zanix space build` actually runs (see `command.ts`'s own doc), that's exactly
 * the point where paying for it is correct.
 */
async function spaceBuildAction(this: Commander, options: SpaceBuildOptions) {
  assertProjectType(this, ['space', 'space-server'], 'space build')

  const root = Deno.cwd()
  // Before anything else touches this project's own tree — same reasoning as `zanix space dev`'s
  // own identical call: a killed earlier session can leave a `.zanix-import-*.js` temp file
  // behind, and nothing else ever revisits an orphan a random UUID names uniquely. See
  // `sweepStaleGeneratedModules`'s own doc for the full account.
  await sweepStaleGeneratedModules(root)
  await importSpaceApp(this, root)

  const { getGlobalCssPaths, getPwaConfig, getActiveRenderer, getMessagesDir, getRoutesDir } =
    await import('@zanix/space')

  // Both projections of the project's one renderer choice must agree before anything is built —
  // see `assertRendererConsistency`'s own doc for why the mismatch is otherwise baffling rather
  // than merely wrong. `getActiveRenderer()` reads what `space.app.ts` just declared (set eagerly
  // by `defineSpaceApp`, before `activateApps()` ever runs).
  assertRendererConsistency(this, root, getActiveRenderer())

  // Compile + VALIDATE runs BEFORE the (much slower) client build below — a broken message catalog
  // is cheap to catch and should fail the build fast, not after several seconds of Vite work.
  // `messagesDir` absent means this project never opted into `loadMessages()` at all — nothing to
  // compile, silently. `resolvedOutDir` is computed independently of `buildSpaceClient`'s own
  // return value (not available yet at this point) — same default literal (`'.dist/client'`) that
  // option's own doc above documents, and that `SpaceAppConfig.clientBuildDir` is expected to match
  // by convention (same relationship `clientBuildDir` and `--out-dir` already have for the client
  // bundle itself).
  //
  // The actual WRITE is deliberately deferred until AFTER `buildSpaceClient` runs, below — NOT
  // fused into one step here, even though that would read simpler. `buildSpaceClient` builds with
  // Vite's `emptyOutDir: true`, which deletes `outDir`'s own existing contents before writing the
  // client bundle; writing compiled messages here, before that runs, means Vite immediately wipes
  // them out again.
  const resolvedOutDir = options.outDir ?? '.dist/client'
  const messagesDir = getMessagesDir()
  let compiledMessages: CompileTreeResult | undefined
  if (messagesDir && options.messages !== false) {
    const { compileMessagesTree, assertNoCompileFailures } = await import(
      'commands/space/shared/compile-messages.ts'
    )
    compiledMessages = await compileMessagesTree(messagesDir)
    assertNoCompileFailures(compiledMessages)
  }

  // Same "before the slow Vite build" fail-fast timing as the messages compile step above, and the
  // same reason: a broken query/mutation is cheap to catch and should stop the build before
  // anything else runs, not surface as a confusing failure several seconds into `buildSpaceClient`.
  // `gql/` sits alongside `routesDir` — see `runGraphqlCheck`'s own doc for why this derives the
  // Space root from `getRoutesDir()`'s own parent rather than a hardcoded `src/space`.
  if (options.graphqlCheck !== false) {
    const { runGraphqlCheck, assertNoGraphqlCheckFailures, reportGraphqlCheckWarnings } =
      await import('commands/space/shared/graphql-check.ts')
    // `getRoutesDir()` is `string | string[]` (host composition, mirroring `messagesDir`'s own
    // shape) — `gql/`/`clients/` are a single Space app's own convention, so only the FIRST root is
    // ever used to derive where they live, the same "pick the primary root" default this command
    // has no reason to second-guess further.
    const primaryRoutesDir = [getRoutesDir()].flat()[0]
    const graphqlResult = await runGraphqlCheck(root, dirname(resolve(root, primaryRoutesDir)))
    reportGraphqlCheckWarnings(graphqlResult)
    assertNoGraphqlCheckFailures(graphqlResult)
  }

  const { buildSpaceClient } = await import('@zanix/space/vite')

  // Reads back what importing `space.app.ts` just set — `defineSpaceApp` calls
  // `setGlobalCssPaths(globalCss)`/`setPwaConfig(pwa)` eagerly, at import time — no need to
  // inspect the returned `ZanixAppDefinition` itself for either.
  const globalCss = getGlobalCssPaths()
  const pwa = getPwaConfig()

  // Flags translate to a `ValidationConfig` and nothing else — every semantic lives in
  // `@zanix/space`'s own resolver, which this command never second-guesses. The project's own
  // `defineSpaceApp({ validation })` is the base; flags win field by field over it.
  const {
    resolveValidationFlags,
    mergeValidationConfig,
    getValidationConfig,
    formatDiagnostic,
    hasBlockingDiagnostics,
  } = await import('@zanix/space')

  const flags = resolveValidationFlags(toValidationFlags(options))
  const validation = flags.enabled
    ? mergeValidationConfig(getValidationConfig(), flags.config)
    : false

  const result = await buildSpaceClient({
    root,
    outDir: resolvedOutDir,
    minify: options.minify,
    globalCss,
    pwa,
    validation,
    // See `fixNpmSlashSpecifierPlugin`'s own doc: a real, confirmed `@deno/vite-plugin` bug, not
    // this command's own — worked around here rather than left to break every real consumer's
    // `--renderer react` (and, less commonly, `preact`) production build.
    plugins: [fixNpmSlashSpecifierPlugin()],
    // `zanix space build` runs `buildSpaceClient` (and its own `discoverPages` page-discovery pass)
    // from inside `@zanix/cli`'s own process, never a freshly spawned one rooted at `root` — without
    // this, a page/layout importing a project-local import-map alias (declared only in this
    // project's own `deno.json(c)`) would resolve against `@zanix/cli`'s OWN configuration instead
    // and fail with "not a dependency and not in import map". See `importProjectModule`'s own doc
    // for the full mechanism, and `BuildSpaceClientOptions.importModule`'s own doc in `@zanix/space`
    // for why this is a real, previously-unpatched gap.
    importModule: importProjectModule,
  })

  // Written HERE, after `buildSpaceClient` — see the comment above `compiledMessages` for why.
  // `messagesDir` is re-read (not re-derived) as the exact pairing `compiledMessages` was compiled
  // from; `writeCompiledCatalogs` trusts that pairing, it doesn't re-verify it.
  if (compiledMessages !== undefined && messagesDir) {
    const { writeCompiledCatalogs } = await import('commands/space/shared/compile-messages.ts')
    await writeCompiledCatalogs(compiledMessages, messagesDir, result.outDir)
  }

  // Same "written after buildSpaceClient, never before" reasoning as `compiledMessages` above —
  // Vite's own `emptyOutDir` would otherwise wipe this the moment it ran. `result.sitemapEntries`
  // is only ever present for `defineSpaceApp({ sitemap: 'auto' })` (see `BuildSpaceClientResult`'s
  // own doc); a literal array or function source needs no manifest at all, since production reads
  // either straight from the app's own declaration, never a build artifact.
  if (result.sitemapEntries !== undefined) {
    await Deno.writeTextFile(
      `${result.outDir}/sitemap-manifest.json`,
      JSON.stringify(result.sitemapEntries),
    )
  }

  if (options.obfuscate) {
    const jsFiles: string[] = []
    // `outDir/assets` never gets created at all for a valid-but-empty app (zero comets, no
    // globalCss, no pwa, no assetsDir — see `buildSpaceClient`'s own doc for why that's a real,
    // unusual-but-valid state, not an error) — `Deno.readDir` on a path that was never created
    // throws `NotFound`, which just means there's nothing here to obfuscate.
    try {
      for await (const entry of Deno.readDir(`${result.outDir}/assets`)) {
        if (entry.isFile && entry.name.endsWith('.js')) {
          jsFiles.push(`assets/${entry.name}`)
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    // `sw.js` (when `pwa` is configured) lives directly under `outDir`, not `outDir/assets` — a
    // real, meaningful piece of client-facing logic, obfuscated the same as any comet chunk.
    const swPath = `${result.outDir}/sw.js`
    const hasSw = await Deno.stat(swPath).then(() => true).catch(() => false)
    if (hasSw) jsFiles.push('sw.js')

    await Promise.all(
      jsFiles.map((relativePath) => obfuscateFile(`${result.outDir}/${relativePath}`)),
    )
  }

  logger.success(
    `zanix space build complete: ${result.comets.length} comet(s) built to '${result.outDir}'` +
      (options.obfuscate ? ' (obfuscated)' : ''),
  )

  if (flags.enabled) {
    const skipped = [...result.validationSkipped]
    if (flags.phases.render) {
      // `--validation=render` is accepted here and reported as not run, rather than run wrongly.
      // This command imports the app manifest but never calls `activateApps()`, so no routes are
      // loaded and — for a `renderer: 'preact'` project — the Preact page renderer is never
      // registered. Probing under those conditions would render every page with the WRONG renderer
      // and report confident findings about a document the app will never serve. `zanix space dev`
      // activates the app, so that is where the probe runs.
      skipped.push(
        'The render probe (--validation=render) does not run during a build: the app is not ' +
          'activated here, so routes are not loaded and the configured renderer is not registered. ' +
          'Run `zanix space dev --validation=render` for the render phase.',
      )
    }

    const blocking = reportValidation({
      diagnostics: result.diagnostics,
      skipped,
      entries: result.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        // No severity label in the text: the logger channel already conveys it, and printing both
        // reads the severity twice.
        text: formatDiagnostic(diagnostic, { severityLabel: false }),
      })),
      blocking: hasBlockingDiagnostics(result.diagnostics),
    })
    failOnBlockingDiagnostics(this, blocking)
  }

  // See `force-exit.ts`'s own doc: `buildSpaceClient` above already finished (every manifest/
  // chunk written, `logger.success` above already ran), but a native npm addon it loads can leave
  // the OS process itself unable to exit on its own. Reached only on genuine success —
  // `failOnBlockingDiagnostics` above already threw before this line otherwise.
  requestForceExit()
}

export default spaceBuildAction
