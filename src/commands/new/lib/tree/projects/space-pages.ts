import { join } from '@std/path'
import { errorCatalogKeys, errorTemplate } from 'commands/generate/error/template.ts'
import { notFoundCatalogKeys, notFoundTemplate } from 'commands/generate/not-found/template.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { getProjectMessageLangs } from 'commands/generate/shared/project.ts'
import { mergeMessageKeys } from 'commands/generate/shared/messages-merge.ts'
import type { RendererName } from 'commands/new/lib/renderer.ts'
import type { ThemeName } from 'commands/new/lib/tree/themes.ts'

/**
 * `zanix new space --pages <pages>` — pre-seeds the same special-file pages `zanix generate
 * error`/`zanix generate not-found` write into an EXISTING project, at scaffold time. Reuses those
 * commands' own template functions directly ({@linkcode errorTemplate}/{@linkcode
 * notFoundTemplate}) rather than duplicating their content — one source of truth for both entry
 * points. Independent of `--icons`: omitted entirely (the default), a generated project simply
 * keeps relying on `@zanix/space`'s own built-in `DefaultErrorView`/not-found fallback, same as
 * today. `--renderer` DOES matter for `'error'` specifically — `errorTemplate`'s own "Try again"
 * action is a real `@zanix/space-ui` `Button`, so the file needs to import from whichever entry
 * point (`@zanix/space-ui` or `/preact`) the project actually installs. `--theme` matters for
 * BOTH pages — `'astronaut'` picks space-flavored fallback copy (both templates' doc), any other
 * value (or omitted) keeps the plain, generic copy — passed straight from the scaffold's own
 * already-resolved `theme` (unlike the standalone `zanix generate` commands, which have to derive
 * it from disk via `getProjectTheme`, since a scaffold-time `--theme` never gets persisted
 * anywhere).
 *
 * @module
 */

/** Every `--pages` value that exists. */
export const KNOWN_PAGES = ['error', 'not-found'] as const

export type PageName = typeof KNOWN_PAGES[number]

/**
 * Parses `--pages`' own comma-separated string (same convention `--fmt-files`/`--lint-files`
 * already use) into a plain list — `undefined` (the flag was never passed) resolves to an empty
 * list, never `['undefined']`.
 */
export function parsePagesFlag(pages: string | undefined): string[] {
  return pages?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
}

/**
 * Throws a plain `Error` (same never-`this.throw`-directly convention as `assertKnownTheme`) if
 * any requested page isn't in {@linkcode KNOWN_PAGES}. Called before anything is written, same
 * "validate every flag up front" ordering `assertKnownTheme`/`assertValidRenderer` already
 * establish for `--theme`/`--renderer`.
 */
export function assertKnownPages(pages: string[]): asserts pages is PageName[] {
  for (const page of pages) {
    if (!(KNOWN_PAGES as readonly string[]).includes(page)) {
      throw new Error(
        `Unknown --pages value '${page}'. Supported values: ${KNOWN_PAGES.join(', ')}.`,
      )
    }
  }
}

/**
 * The root-level error boundary (`routes/error.tsx`) — the same whole-app-root shape
 * `zanix generate error` would produce for an empty route path (`pascalNameFromRoutePath('')`
 * resolves to `'Index'`), since a fresh scaffold has no other route segment to scope it to yet.
 * `renderer` picks which `@zanix/space-ui` entry point the generated `Button` import resolves
 * against — same threading every other renderer-aware template already gets. `messageLangs`
 * (`getProjectMessageLangs`) is real disk state by the time this runs — `--template population`/
 * `population-lang` (`applyPopulationScaffold`) already wrote `messages/` before
 * `ensureSpaceScaffoldSideEffects` reaches this step, for a `zanix new` call that requests both.
 */
async function writeErrorPage(
  root: string,
  routesDir: string,
  renderer: RendererName | undefined,
  theme: ThemeName | undefined,
): Promise<void> {
  const messageLangs = getProjectMessageLangs(root)
  await Deno.mkdir(routesDir, { recursive: true })
  await Deno.writeTextFile(
    join(routesDir, 'error.tsx'),
    errorTemplate(pascalNameFromRoutePath(''), renderer, theme, messageLangs),
  )
  if (messageLangs?.length) {
    await mergeMessageKeys(root, messageLangs, (lang) => errorCatalogKeys(theme, lang))
  }
}

/** The whole-app `routes/not-found.tsx` singleton — identical output to `zanix generate
 * not-found`, including its own `messageLangs`-gated `IntlProvider` wiring (same reasoning as
 * {@linkcode writeErrorPage}'s own doc). */
async function writeNotFoundPage(
  root: string,
  routesDir: string,
  renderer: RendererName | undefined,
  theme: ThemeName | undefined,
): Promise<void> {
  const messageLangs = getProjectMessageLangs(root)
  await Deno.mkdir(routesDir, { recursive: true })
  await Deno.writeTextFile(
    join(routesDir, 'not-found.tsx'),
    notFoundTemplate(theme, renderer, messageLangs),
  )
  if (messageLangs?.length) {
    await mergeMessageKeys(root, messageLangs, (lang) => notFoundCatalogKeys(theme, lang))
  }
}

/**
 * Writes every requested `--pages` file into `${root}/src/space/routes/` — the same `routesDir`
 * every preset's own `space.app.ts` already declares (see `space.ts`'s own doc for why that must
 * match `getSpaceSrcTree`'s real output exactly). Each page is independent: one failing (a real
 * filesystem error) never blocks the other from landing.
 */
export async function writeRequestedPages(
  root: string,
  pages: readonly PageName[],
  renderer?: RendererName,
  theme?: ThemeName,
): Promise<void> {
  const routesDir = join(root, 'src', 'space', 'routes')
  if (pages.includes('error')) await writeErrorPage(root, routesDir, renderer, theme)
  if (pages.includes('not-found')) await writeNotFoundPage(root, routesDir, renderer, theme)
}
