import type { Commander } from 'cli'

import { getConfigDir, readConfig } from '@zanix/helpers'

/**
 * Reads the `zanix.project` type of the Zanix project rooted at `root` (defaults to `Deno.cwd()`),
 * or `undefined` if no config file exists or it can't be parsed.
 */
export function getCurrentProjectType(root?: string): string | undefined {
  const configPath = getConfigDir(root)
  if (!configPath) return undefined

  try {
    return readConfig(configPath).zanix?.project
  } catch {
    return undefined
  }
}

/** The renderers a `space`/`space-server` project can be built against. */
export type ProjectRenderer = 'react' | 'preact'

/**
 * Resolves which renderer the project rooted at `root` uses.
 *
 * ## One knob, one source of truth
 *
 * A project selects its renderer in exactly ONE place: `defineSpaceApp({ renderer })` in its own
 * `space.app.ts`. That is the source of truth, it is what `@zanix/space` itself reads at runtime,
 * and nothing else competes with it.
 *
 * `compilerOptions.jsxImportSource` in the project's `deno.json(c)` is not a second knob — it is the
 * COMPILE-TIME PROJECTION of that same choice, written once by `zanix new space --renderer=...`
 * from the same flag that seeds `space.app.ts`. This function derives the renderer from it, and the
 * derivation is sound for a specific reason worth stating: `jsxImportSource` is what every `.tsx`
 * file in the project actually transpiles against. A generator's entire job is emitting `.tsx`, so
 * what matters to it is not what the app declares at runtime but what the file it writes will
 * compile to — and those two cannot disagree in a working project. A Preact app whose
 * `jsxImportSource` still says `react` does not merely generate the wrong template; it does not
 * function at all, because every component in it produces the wrong element type. The divergence
 * this derivation could theoretically suffer from is therefore never a silently-wrong generator, it
 * is an already-broken project.
 *
 * A dedicated `zanix.renderer` config field was considered and deliberately REJECTED. It would have
 * been a genuinely independent value that could drift away from both `space.app.ts` and
 * `jsxImportSource` with nothing forcing them back into agreement — a second way to answer a
 * question that already has an answer. Deriving costs nothing and cannot drift.
 *
 * Inferring by other means was rejected too: grepping a project's imports is fragile, and importing
 * `space.app.ts` to ask it directly would execute that app's real `defineSpaceApp()` and every
 * `@Page()` decorator it reaches, purely to answer a configuration question.
 *
 * @param root - Project root. Defaults to the current working directory.
 * @returns The project's renderer. Falls back to `'react'` when `jsxImportSource` is absent or is
 * anything other than `'preact'` — which covers a non-space project and any config this CLI did not
 * write, and matches `defineSpaceApp({ renderer })`'s own documented default ("choosing 'react'
 * explicitly or omitting this field are identical in every respect").
 */
export function getProjectRenderer(root?: string): ProjectRenderer {
  const configPath = getConfigDir(root)
  if (!configPath) return 'react'

  try {
    return readConfig(configPath).compilerOptions?.jsxImportSource === 'preact' ? 'preact' : 'react'
  } catch {
    return 'react'
  }
}

/**
 * Throws a clear error (via `this.throw`) unless the current project's `zanix.project` type is one
 * of `allowed`.
 */
export function assertProjectType(
  cwd: Commander,
  allowed: string[],
  generatorName: string,
  root?: string,
): void {
  const projectType = getCurrentProjectType(root)

  if (!projectType || !allowed.includes(projectType)) {
    const allowedList = allowed.map((type) => `'${type}'`).join(' or ')
    cwd.throw(
      new Error(
        `The '${generatorName}' generator must be run inside a ${allowedList} project.`,
      ),
    )
  }
}
