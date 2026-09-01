import type { Commander } from 'cli'

import { getConfigDir, readConfig } from '@zanix/helpers'
import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import { join } from '@std/path'

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
 * Resolves whether the project rooted at `root` (defaults to `Deno.cwd()`) was scaffolded with
 * `--theme astronaut` — the one distinction `errorTemplate`/`notFoundTemplate` (`generate/error/
 * template.ts`, `generate/not-found/template.ts`) need to pick astronaut-flavored fallback copy.
 *
 * Unlike `renderer` (a real runtime configuration value with its own compile-time projection,
 * `jsxImportSource`), `--theme` has no persisted config field at all — it is a pure scaffold-time
 * content/CSS choice, never read again by `@zanix/space` itself (see `themes.ts`'s own doc). The
 * one real, on-disk signal a standalone `zanix generate` command (run against an EXISTING project,
 * long after `zanix new` ran) can check is the theme's own CSS output: `--theme astronaut`
 * (`space-astronaut.ts`) is the only theme that writes `theme/astronaut.css` at the project root —
 * if that file exists, the project chose that theme; if it doesn't (no theme, or `--theme
 * default`), this resolves to `undefined`, and both templates fall back to their plain,
 * theme-agnostic copy.
 */
export function getProjectTheme(root?: string): ThemeName | undefined {
  const projectRoot = root ?? Deno.cwd()
  try {
    Deno.statSync(join(projectRoot, 'theme', 'astronaut.css'))
    return 'astronaut'
  } catch {
    return undefined
  }
}

/**
 * Resolves the catalog folder names under the project's own `messages/` directory (e.g.
 * `['en', 'es']`, or `['default']` for `--template population`'s implicit-lang convention — see
 * `@zanix/space`'s own `DEFAULT_IMPLICIT_LANG`), or `undefined` when no `messages/` directory
 * exists at all — `errorTemplate`/`notFoundTemplate` (`generate/error/template.ts`, `generate/
 * not-found/template.ts`) use this to decide whether the generated file should wire up
 * `IntlProvider`/`useIntl` at all.
 *
 * Same disk-existence heuristic {@linkcode getProjectTheme} already uses, for the same reason:
 * `messagesDir` is a real `defineSpaceApp()` config value, but nothing persists WHICH languages it
 * declares anywhere a standalone `zanix generate` command (run long after `zanix new` scaffolded
 * the project) can read back except the catalog folders themselves.
 */
export function getProjectMessageLangs(root?: string): string[] | undefined {
  const projectRoot = root ?? Deno.cwd()
  try {
    const langs: string[] = []
    for (const entry of Deno.readDirSync(join(projectRoot, 'messages'))) {
      if (entry.isDirectory) langs.push(entry.name)
    }
    return langs.length > 0 ? langs : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the project rooted at `root` (defaults to `Deno.cwd()`) already declares `pkg` in its
 * `deno.json(c)` `imports` map — the same signal `ensureZanixDependency`
 * (`utils/config/dependencies.ts`) writes to and checks before adding an entry. `false` for any
 * package not yet declared, or when no config file exists/parses at all.
 *
 * Used by a generator that produces a shell depending on some OTHER package's own runtime
 * registration (see `connector`'s own `--slot database`/`--slot cache:<subtype>` precondition
 * warning) to give a real, cheap "is the thing this shell needs even present" signal instead of
 * guessing from the generated file's own content.
 */
export function isZanixDependencyDeclared(root: string | undefined, pkg: string): boolean {
  const configPath = getConfigDir(root)
  if (!configPath) return false

  try {
    return Boolean(readConfig(configPath).imports?.[pkg])
  } catch {
    return false
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
