import type { Commander } from 'cli'

import { getConfigDir, readConfig } from '@zanix/helpers'

/**
 * Fails loudly when a project's declared renderer and its JSX transpilation target disagree.
 *
 * ## Why this exists
 *
 * A project selects its renderer in exactly ONE place — `defineSpaceApp({ renderer })` in its own
 * `space.app.ts`. Everything else is a projection of that single choice, seeded from the same
 * `--renderer` flag by `zanix new space`. But the two projections are consumed by different things
 * at different times and neither can read the other:
 *
 * - `defineSpaceApp({ renderer })` is what `@zanix/space` reads at RUNTIME, to pick a page renderer,
 *   a not-found renderer and a document shell.
 * - `compilerOptions.jsxImportSource` is what Deno reads at TRANSPILE time, to decide which
 *   `jsx-runtime` every `.tsx` file in the project imports.
 *
 * Neither can be removed. A JSR-published runtime cannot reliably read a project's `deno.json` (it
 * depends on the working directory and the file may not even ship with a deployment), and the
 * compiler genuinely requires the setting to be in its own config. So there are two places a person
 * could edit — which is exactly the drift risk that makes "one knob" a claim rather than a fact.
 *
 * This check closes that gap by making the disagreement impossible to have silently. It does not
 * add a third source of truth; it asserts that the two projections of the one source agree, and
 * refuses to build otherwise.
 *
 * ## Why the failure would otherwise be baffling
 *
 * The mismatch does not produce a clean error on its own. Every component in the project transpiles
 * against one runtime's `jsx-runtime` while the framework renders with the other's — so components
 * produce element objects the active renderer does not recognise. Depending on the direction, that
 * surfaces as blank output, a serializer throwing on an unfamiliar shape, or markup that renders but
 * hydrates into nothing. None of those point at the real cause.
 */
export function assertRendererConsistency(
  cwd: Commander,
  root: string,
  declaredRenderer: 'react' | 'preact',
): void {
  const configPath = getConfigDir(root)
  if (!configPath) return

  let jsxImportSource: string | undefined
  try {
    jsxImportSource = readConfig(configPath).compilerOptions?.jsxImportSource
  } catch {
    // An unreadable/absent config is not this check's problem — every other part of the command
    // will report it far more clearly than a renderer mismatch would.
    return
  }

  // Absent is not a mismatch: a project that never set it is not claiming anything to disagree
  // with, and Deno will fail on its own the first time it transpiles JSX.
  if (jsxImportSource === undefined) return
  if (jsxImportSource === declaredRenderer) return

  cwd.throw(
    new Error(
      `Renderer mismatch: space.app.ts declares \`renderer: '${declaredRenderer}'\`, but ` +
        `deno.json sets \`compilerOptions.jsxImportSource: '${jsxImportSource}'\`.\n\n` +
        `These are two projections of ONE choice and must agree. Set jsxImportSource to ` +
        `'${declaredRenderer}' (and make sure '${declaredRenderer}' is in \`imports\`), or change ` +
        `the renderer in space.app.ts to '${jsxImportSource}'.\n\n` +
        'This is a build error on purpose. Left alone, every component in this project would ' +
        "transpile against one renderer's jsx-runtime while the framework rendered with the " +
        "other's — which surfaces as blank output, a serializer error on an unfamiliar element " +
        'shape, or markup that renders but never hydrates, none of which point at the real cause.',
    ),
  )
}
