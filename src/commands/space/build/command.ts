import type { Commander } from 'cli'

import { assertProjectType } from 'commands/generate/shared/project.ts'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'
import {
  registerValidationOptions,
  type SpaceValidationOptions,
  toValidationFlags,
} from 'commands/space/shared/validation-flags.ts'
import {
  failOnBlockingDiagnostics,
  reportValidation,
} from 'commands/space/shared/report-validation.ts'
import { assertRendererConsistency } from 'commands/space/shared/assert-renderer-consistency.ts'
import { obfuscateFile } from 'commands/build/lib/obfuscate.ts'
import logger from '@zanix/utils/logger'

/** Options `spaceBuildAction` accepts, straight off the parsed CLI flags. */
interface SpaceBuildOptions extends SpaceValidationOptions {
  outDir?: string
  minify?: boolean
  obfuscate?: boolean
  messages?: boolean
}

/**
 * `zanix space build`'s real orchestration: imports the project's own `space.app.ts` manifest
 * (same as `zanix space dev` — never `mod.ts`, see `importSpaceApp`'s own doc for why), reads back
 * its declared `globalCss`/`pwa` (`getGlobalCssPaths`/`getPwaConfig`, both set eagerly by
 * `defineSpaceApp` at import time), and builds the real, production CLIENT bundle via
 * `@zanix/space/vite`'s `buildSpaceClient` — comets, CSS, PWA icons/service worker, and their
 * manifests. `pwa` is passed straight through unchanged: `PwaConfig` (what `defineSpaceApp({ pwa
 * })` already takes) IS `buildSpaceClient`'s own `pwa` option shape — no separate plugin
 * configuration needed here at all (see `PwaConfig`'s own doc in `@zanix/space` for the full
 * design). `renderer` is NOT read back explicitly here, unlike `globalCss`/`pwa` — it doesn't need
 * to be: `buildSpaceClient`'s own `renderer` option already defaults to `getActiveRenderer()`
 * internally (the same eager flag `defineSpaceApp({ renderer })` populates), so this command gets
 * the right renderer's Vite plugin automatically, purely from having already imported
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
 * AST in place (`writeCompiledMessagesTree`, `commands/space/shared/compile-messages.ts`) —
 * `--no-messages` opts out, same convention as `--no-minify`. This isn't "building the server":
 * `loadMessages()` reads the exact same file path either way and never learns anything happened
 * (see that compiler's own module doc for why in-place is safe here — this command runs against an
 * ephemeral CI/deploy checkout, never a developer's live working copy). A compile failure fails the
 * WHOLE build before anything else runs (`assertNoCompileFailures`, inside
 * `writeCompiledMessagesTree` itself) — never a build that "succeeds" while quietly leaving a
 * broken message catalog on disk.
 *
 * `@zanix/space`/`@zanix/space/vite` are imported dynamically, INSIDE this function, never as a
 * static top-level import — `commands/mod.ts` eagerly imports every command's own module (this one
 * included) just to REGISTER its CLI surface, regardless of which command a user actually runs. A
 * static import here would drag `@zanix/space/vite`'s entire dependency graph (Vite, React,
 * Tailwind, `sharp`, vanilla-extract, ...) into EVERY `zanix` invocation, not just `space build` —
 * confirmed as a real regression, not a theoretical one: a plain `zanix new server` (touching none
 * of this) hung for 30+ minutes cold-resolving that graph before this was made lazy. Same pattern
 * `zanix build`'s own `mainBuilderFunction` already uses for `npm:esbuild`, for the identical
 * reason — see that file's own `await import(...)` call. `writeCompiledMessagesTree`
 * (`commands/space/shared/compile-messages.ts`) is imported the same lazy way, for the same
 * reason — it pulls in `@formatjs/icu-messageformat-parser`, which no `zanix` invocation outside
 * `space build` should ever load.
 */
async function spaceBuildAction(this: Commander, options: SpaceBuildOptions) {
  assertProjectType(this, ['space', 'space-server'], 'space build')

  const root = Deno.cwd()
  await importSpaceApp(this, root)

  const { getGlobalCssPaths, getPwaConfig, getActiveRenderer, getMessagesDir } = await import(
    '@zanix/space'
  )

  // Both projections of the project's one renderer choice must agree before anything is built —
  // see `assertRendererConsistency`'s own doc for why the mismatch is otherwise baffling rather
  // than merely wrong. `getActiveRenderer()` reads what `space.app.ts` just declared (set eagerly
  // by `defineSpaceApp`, before `activateApps()` ever runs).
  assertRendererConsistency(this, root, getActiveRenderer())

  // Runs BEFORE the (much slower) client build below — a broken message catalog is cheap to catch
  // and should fail the build fast, not after several seconds of Vite work. `messagesDir` absent
  // means this project never opted into `loadMessages()` at all — nothing to compile, silently.
  const messagesDir = getMessagesDir()
  if (messagesDir && options.messages !== false) {
    const { writeCompiledMessagesTree } = await import('commands/space/shared/compile-messages.ts')
    await writeCompiledMessagesTree(messagesDir)
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
    outDir: options.outDir,
    minify: options.minify,
    globalCss,
    pwa,
    validation,
  })

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
}

export default spaceBuildAction

export function registerSpaceBuildCommand(cwd: Commander): void {
  const command = cwd.command('build')
    .description(
      "Builds this @zanix/space project's real, production CLIENT bundle: comets (each its " +
        'own hashed chunk), CSS, and their manifests — never the SSR/server side, which keeps ' +
        "running directly against source (see this command's own doc for why).",
    )
    .option(
      '--out-dir <outDir:string>',
      "Client output directory, relative to the project root. Defaults to 'dist/client'.",
    )
    .option(
      '--no-minify',
      "A flag indicating the output won't be minified. Minified by default.",
    )
    .option(
      '--obfuscate',
      'A flag to obfuscate every built .js file. Defaults to `false`.',
    )
    .option(
      '--no-messages',
      'Skips compiling defineSpaceApp({ messagesDir }) ICU catalogs to AST. Compiled by ' +
        'default when messagesDir is configured; has no effect otherwise.',
    )
  registerValidationOptions(command)
  command.action((options: SpaceBuildOptions) => spaceBuildAction.call(cwd, options))
}
