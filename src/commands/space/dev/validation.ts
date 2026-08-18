import type { SpaceValidationOptions } from 'commands/space/shared/validation-flags.ts'
import type { ValidationReport } from 'commands/space/shared/report-validation.ts'
import { toValidationFlags } from 'commands/space/shared/validation-flags.ts'

/**
 * Runs document validation for `zanix space dev`.
 *
 * **This is where the render phase actually happens.** `zanix space build` accepts
 * `--validation=render` and reports it as not run, because a build imports the app manifest without
 * ever calling `activateApps()`: no routes are loaded, and for a `renderer: 'preact'` project the
 * Preact page renderer is never registered, so a probe there would render every page with the wrong
 * renderer and report confident findings about a document the app will never serve. Dev activates
 * the app, so both the route tree and the configured renderer are real by the time this runs.
 *
 * **The renderer arrives the same way it does everywhere else in this framework** — through the page
 * renderer registry that `defineSpaceApp({ renderer })` populates. Nothing here inspects imports,
 * reads config files or scans sources to decide it.
 *
 * The CLI's whole job is translating flags and presenting results. Every semantic — which phases a
 * mode runs, what strict means, which rules exist and how severe they are — belongs to
 * `@zanix/space`'s validation module, and none of it is duplicated here.
 *
 * @module
 */

/** A dynamic import of `@zanix/space`, matching how every other `zanix space` command reaches it —
 * `commands/mod.ts` eagerly imports each command's module just to register its CLI surface, so a
 * static import would drag that entire dependency graph into every `zanix` invocation. */
async function loadSpace() {
  return await import('@zanix/space')
}

/**
 * Resolves flags, runs the phases they asked for, and returns a report to present.
 *
 * @param options - Raw CLI options for this command.
 * @param routesRoot - Project root, used to locate the routes directory.
 * @returns `undefined` when validation is switched off entirely, so the caller prints nothing at
 * all rather than announcing an empty run.
 */
export async function runDevValidation(
  options: SpaceValidationOptions,
  routesRoot: string,
): Promise<ValidationReport | undefined> {
  const space = await loadSpace()
  const {
    resolveValidationFlags,
    mergeValidationConfig,
    getValidationConfig,
    formatDiagnostic,
    hasBlockingDiagnostics,
  } = space

  const flags = resolveValidationFlags(toValidationFlags(options))
  if (!flags.enabled) return undefined

  const config = mergeValidationConfig(getValidationConfig(), flags.config)
  if (config === false) return undefined

  const { discoverPages, validateBuild, runRenderProbe } = await import('@zanix/space/vite')

  const routesDir = `${routesRoot}/src/space/routes`
  const pages = await discoverPages(routesDir)

  const staticResult = await validateBuild({ pages, routesDir, config })
  const diagnostics = [...staticResult.diagnostics]
  const skipped = [...staticResult.skipped]

  if (flags.phases.render) {
    const probe = await runRenderProbe({
      pages,
      // Resolving a page class from its module is the dev command's own concern; the probe never
      // loads modules itself, which is what keeps it testable and free of any opinion about how a
      // project is laid out.
      loadPage: async (page) => {
        const filePath = await Deno.realPath(page.filePath)
        const module = await import(filePath) as { default?: unknown }
        const Target = module.default
        if (!Target) return undefined
        // `component` is an instance field, so it only exists on a constructed page — the same
        // reason discovery cannot read it either.
        const instance = new (Target as new (ctx: unknown) => { component?: unknown })({})
        return { Target: Target as never, Component: instance.component }
      },
      // No `renderPage`: the probe uses whatever renderer the APPLICATION installed by importing
      // `@zanix/space/react` or `@zanix/space/preact` — which is the only correct answer, since the
      // project already declared its renderer through `defineSpaceApp({ renderer })`. The CLI never
      // picks one, and no longer reaches into `@zanix/space`'s renderer registry to do it.
      config,
    })
    diagnostics.push(...probe.diagnostics)
    skipped.push(...probe.skipped)
  } else {
    skipped.push(
      'The render phase did not run. Pass --validation=render to render each static route and ' +
        'validate the real document it produces.',
    )
  }

  const sorted = space.sortDiagnostics(diagnostics)
  return {
    diagnostics: sorted,
    skipped,
    entries: sorted.map((diagnostic) => ({
      severity: diagnostic.severity,
      text: formatDiagnostic(diagnostic, { severityLabel: false }),
    })),
    blocking: hasBlockingDiagnostics(sorted),
  }
}
