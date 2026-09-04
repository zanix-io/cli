import { getIntlMessagesTypeName, getSpaceUiEntry } from 'commands/new/lib/renderer.ts'
import type { RendererName } from 'commands/new/lib/renderer.ts'
import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import { resolveThemedCopy } from 'commands/generate/shared/themed-copy.ts'

/**
 * Boilerplate for `zanix generate not-found`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Matches `@zanix/space`'s own real, current `not-found.tsx` convention: a single, whole-app
 * singleton at the routes root (never per-route, unlike `layout`/`error`/`loading`) — the first
 * directory in `routesDir` to declare one wins, app-wide. `loadRoutes()` discovers it purely from
 * its file location; a project that never generates one falls back to `@zanix/space`'s own built-in
 * default view. Shape matches that same built-in default (`DefaultNotFoundView`) — a plain,
 * no-props, default-exported function component (or, when `messageLangs` is given, one accepting
 * `NotFoundProps` — see below).
 *
 * The title is declared via a named `head` export, never inline `<title>` JSX — `load-routes.ts`
 * reads `notFound.head` (the whole module's own named export, exactly like a `layout.tsx`'s
 * `head`) and hands it to `createNotFoundHandler`'s own document-model resolution
 * (`DEFAULT_NOT_FOUND_HEAD` is only ever a fallback for a project with no `not-found.tsx` at all).
 * An inline `<title>` element rendered INSIDE the component's own JSX gets hoisted into `<head>`
 * independently of that resolution (a real, confirmed regression: with the previous template, a
 * project customizing only that inline title ended up with BOTH the old `head`-resolved title and
 * the new inline one in the same document, since neither mechanism knows about the other). This
 * `head` export is always static (never a function of `messages`) for the same reason: it's read
 * once, at route-registration time, long before any request (and its resolved `lang`) exists — a
 * real, current framework limitation, not an oversight this template works around.
 *
 * The root element always carries `data-space='not-found'` — the stable attribute both `--theme
 * default`'s and `--theme astronaut`'s own `[data-space='not-found']` CSS rule already targets
 * (`space-theme.ts`/`space-astronaut.ts`), giving this fallback the same centered, margined
 * container either theme already ships for it. `theme` (`getProjectTheme`, `generate/shared/
 * project.ts`) only ever changes the COPY, resolved via {@linkcode resolveThemedCopy} against
 * {@linkcode THEMED_NOT_FOUND_TITLE}/{@linkcode THEMED_NOT_FOUND_DESCRIPTION}: `'astronaut'` gets a
 * short, space-flavored message matching that theme's visual identity; any theme with no entry in
 * either table (including `undefined`, no theme installed) keeps
 * {@linkcode DEFAULT_NOT_FOUND_TITLE}/{@linkcode DEFAULT_NOT_FOUND_DESCRIPTION}. Adding a future
 * theme's own fallback copy is a one-line addition to each table — never a new branch here.
 *
 * `'astronaut'`'s own rocket is wrapped in `<span className='not-found-rocket'>` — that class's
 * animation, and the rule that hides `astronaut.css`'s own ambient background rocket while this
 * page is on screen, both live in `space-astronaut.ts`'s own `LOCAL_ASTRONAUT_DECORATIONS_CSS`
 * (its "NOT FOUND" section) — never duplicated here, since this template only ever emits markup,
 * not styling. Decorative, so it's never part of a translatable catalog value either.
 *
 * **`messageLangs`** (`getProjectMessageLangs`, `generate/shared/project.ts`) — `undefined`/empty
 * for a project with no `messages/` directory at all keeps the plain, hardcoded-English template
 * unchanged. When the project HAS one, the generated file wraps its content in `IntlProvider`/
 * `useIntl` instead, reading `NotFoundProps.lang`/`messages` (never calling `loadMessages` itself
 * — see those fields' own doc for why they're already resolved) and formatting through two catalog
 * keys, {@linkcode NOT_FOUND_TITLE_KEY}/{@linkcode NOT_FOUND_DESCRIPTION_KEY} — the exact keys
 * {@linkcode notFoundCatalogKeys} seeds into every discovered lang's own `index.json` (via
 * `mergeMessageKeys`, `generate/shared/messages-merge.ts`).
 */

/** Theme-specific title fallback copy — keyed by {@linkcode ThemeName}, missing entries (any theme
 * not listed, or no theme at all) fall back to {@linkcode DEFAULT_NOT_FOUND_TITLE}. */
const THEMED_NOT_FOUND_TITLE: Partial<Record<ThemeName, string>> = { astronaut: 'Lost in space' }
const DEFAULT_NOT_FOUND_TITLE = 'Page not found'

const THEMED_NOT_FOUND_TITLE_ES: Partial<Record<ThemeName, string>> = {
  astronaut: 'Perdido en el espacio',
}
const DEFAULT_NOT_FOUND_TITLE_ES = 'Página no encontrada'

/** Theme-specific description fallback copy — same table/fallback shape as
 * {@linkcode THEMED_NOT_FOUND_TITLE}, its own English default {@linkcode DEFAULT_NOT_FOUND_DESCRIPTION}. */
const THEMED_NOT_FOUND_DESCRIPTION: Partial<Record<ThemeName, string>> = {
  astronaut: "This page doesn't exist — looks like you drifted off course.",
}
const DEFAULT_NOT_FOUND_DESCRIPTION = "The page you're looking for doesn't exist or has moved."

const THEMED_NOT_FOUND_DESCRIPTION_ES: Partial<Record<ThemeName, string>> = {
  astronaut: 'Esta página no existe — parece que te desviaste de curso.',
}
const DEFAULT_NOT_FOUND_DESCRIPTION_ES = 'La página que buscas no existe o fue movida.'

export const NOT_FOUND_TITLE_KEY = 'notFound/title'
export const NOT_FOUND_DESCRIPTION_KEY = 'notFound/description'

/** The catalog keys {@linkcode notFoundTemplate}'s own translated variant reads via
 * `formatMessage`, for one lang folder — passed to `mergeMessageKeys` once per lang
 * `getProjectMessageLangs` finds. */
export function notFoundCatalogKeys(
  theme: ThemeName | undefined,
  lang: string,
): Record<string, string> {
  return lang === 'es'
    ? {
      [NOT_FOUND_TITLE_KEY]: resolveThemedCopy(
        theme,
        THEMED_NOT_FOUND_TITLE_ES,
        DEFAULT_NOT_FOUND_TITLE_ES,
      ),
      [NOT_FOUND_DESCRIPTION_KEY]: resolveThemedCopy(
        theme,
        THEMED_NOT_FOUND_DESCRIPTION_ES,
        DEFAULT_NOT_FOUND_DESCRIPTION_ES,
      ),
    }
    : {
      [NOT_FOUND_TITLE_KEY]: resolveThemedCopy(
        theme,
        THEMED_NOT_FOUND_TITLE,
        DEFAULT_NOT_FOUND_TITLE,
      ),
      [NOT_FOUND_DESCRIPTION_KEY]: resolveThemedCopy(
        theme,
        THEMED_NOT_FOUND_DESCRIPTION,
        DEFAULT_NOT_FOUND_DESCRIPTION,
      ),
    }
}

/** `<span className='not-found-rocket'>🚀</span> ` prefix, astronaut only — decorative markup,
 * never part of a translatable catalog value (see this module's own doc). */
const THEMED_NOT_FOUND_HEADING_PREFIX: Partial<Record<ThemeName, string>> = {
  astronaut: "<span className='not-found-rocket'>🚀</span> ",
}

/** Theme-specific fallback JSX body — keyed by {@linkcode ThemeName}, missing entries (any theme
 * not listed, or no theme at all) fall back to {@linkcode DEFAULT_NOT_FOUND_BODY}. Used only for
 * the plain (non-i18n) template — see {@linkcode notFoundTemplate}'s own `messageLangs` branch for
 * the translated equivalent. */
const THEMED_NOT_FOUND_BODY: Partial<Record<ThemeName, string>> = {
  astronaut: `(
    <div data-space='not-found'>
      <h1>
        <span className='not-found-rocket'>🚀</span> Lost in space
      </h1>
      <p>This page doesn't exist — looks like you drifted off course.</p>
    </div>
  )`,
}

const DEFAULT_NOT_FOUND_BODY = `<h1 data-space='not-found'>404 — Page not found</h1>`

/** `routes/not-found.tsx` */
export const notFoundTemplate = (
  theme?: ThemeName,
  renderer?: RendererName,
  messageLangs?: string[],
): string => {
  if (!messageLangs?.length) {
    const body = resolveThemedCopy(theme, THEMED_NOT_FOUND_BODY, DEFAULT_NOT_FOUND_BODY)

    return `export const head = { title: 'Page not found' }

export default function NotFound() {
  return ${body}
}
`
  }

  const spaceUiEntry = getSpaceUiEntry(renderer)
  const messagesType = getIntlMessagesTypeName(renderer)
  const headingPrefix = resolveThemedCopy(theme, THEMED_NOT_FOUND_HEADING_PREFIX, '')

  return `import type { NotFoundProps } from '@zanix/space'
import { IntlProvider, useIntl } from '${spaceUiEntry}'
import type { ${messagesType} } from '${spaceUiEntry}'

function NotFoundContent() {
  const { formatMessage } = useIntl()

  return (
    <div data-space='not-found'>
      <h1>${headingPrefix}{formatMessage('${NOT_FOUND_TITLE_KEY}')}</h1>
      <p>{formatMessage('${NOT_FOUND_DESCRIPTION_KEY}')}</p>
    </div>
  )
}

export const head = { title: 'Page not found' }

// \`lang\`/\`messages\` (\`NotFoundProps\`) resolve lazily, only once a 404 is already confirmed —
// never call \`loadMessages()\` here. Both are \`undefined\` for a request with no matched
// \`[lang]\` segment at all; \`locale\` falls back to \`'en'\` for that case.
export default function NotFound({ lang, messages }: NotFoundProps) {
  return (
    <IntlProvider locale={lang ?? 'en'} messages={(messages ?? {}) as ${messagesType}}>
      <NotFoundContent />
    </IntlProvider>
  )
}
`
}
