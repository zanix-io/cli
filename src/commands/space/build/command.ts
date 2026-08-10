import type { Commander } from 'cli'

import { assertProjectType } from 'commands/generate/shared/project.ts'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'
import { obfuscateFile } from 'commands/build/lib/obfuscate.ts'
import logger from '@zanix/utils/logger'

/** Options `spaceBuildAction` accepts, straight off the parsed CLI flags. */
interface SpaceBuildOptions {
  outDir?: string
  minify?: boolean
  obfuscate?: boolean
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
 * design). Obfuscation (`--obfuscate`) runs as a separate post-processing pass over every built
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
 * `@zanix/space`/`@zanix/space/vite` are imported dynamically, INSIDE this function, never as a
 * static top-level import — `commands/mod.ts` eagerly imports every command's own module (this one
 * included) just to REGISTER its CLI surface, regardless of which command a user actually runs. A
 * static import here would drag `@zanix/space/vite`'s entire dependency graph (Vite, React,
 * Tailwind, `sharp`, vanilla-extract, ...) into EVERY `zanix` invocation, not just `space build` —
 * confirmed as a real regression, not a theoretical one: a plain `zanix new server` (touching none
 * of this) hung for 30+ minutes cold-resolving that graph before this was made lazy. Same pattern
 * `zanix build`'s own `mainBuilderFunction` already uses for `npm:esbuild`, for the identical
 * reason — see that file's own `await import(...)` call.
 */
async function spaceBuildAction(this: Commander, options: SpaceBuildOptions) {
  assertProjectType(this, ['space', 'space-server'], 'space build')

  const root = Deno.cwd()
  await importSpaceApp(this, root)

  const { getGlobalCssPaths, getPwaConfig } = await import('@zanix/space')
  const { buildSpaceClient } = await import('@zanix/space/vite')

  // Reads back what importing `space.app.ts` just set — `defineSpaceApp` calls
  // `setGlobalCssPaths(globalCss)`/`setPwaConfig(pwa)` eagerly, at import time — no need to
  // inspect the returned `ZanixAppDefinition` itself for either.
  const globalCss = getGlobalCssPaths()
  const pwa = getPwaConfig()

  const result = await buildSpaceClient({
    root,
    outDir: options.outDir,
    minify: options.minify,
    globalCss,
    pwa,
  })

  if (options.obfuscate) {
    const jsFiles: string[] = []
    for await (const entry of Deno.readDir(`${result.outDir}/assets`)) {
      if (entry.isFile && entry.name.endsWith('.js')) jsFiles.push(`assets/${entry.name}`)
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
}

export default spaceBuildAction

export function registerSpaceBuildCommand(cwd: Commander): void {
  cwd.command('build')
    .description(
      "Builds this @zanix/space project's real, production CLIENT bundle: comets (each its " +
        'own hashed chunk), CSS, and their manifests — never the SSR/server side, which keeps ' +
        "running directly against source (see this command's own doc for why).",
    )
    .option(
      '--out-dir <outDir:string>',
      "Client output directory, relative to the project root. Defaults to 'dist/client'.",
    )
    .option('--no-minify', "A flag indicating the output won't be minified. Minified by default.")
    .option('--obfuscate', 'A flag to obfuscate every built .js file. Defaults to `false`.')
    .action((options) => spaceBuildAction.call(cwd, options))
}
