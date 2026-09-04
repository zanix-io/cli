import { getIntlMessagesTypeName, getSpaceUiEntry } from 'commands/new/lib/renderer.ts'
import type { RendererName } from 'commands/new/lib/renderer.ts'
import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import { resolveThemedCopy } from 'commands/generate/shared/themed-copy.ts'

/**
 * Boilerplate for `zanix generate error <route-path>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Matches `@zanix/space`'s own real, current `error.tsx` convention exactly (verified against that
 * package's source, not assumed): a plain default-exported function component receiving
 * `ErrorBoundaryProps` (`error`/`reset`, plus `params`/`messages` when `messageLangs` is given —
 * see below) — never a decorator, never registered on the page's class itself; `loadRoutes()`
 * discovers it purely from its file location, the same way it discovers `layout.tsx`/`loading.tsx`.
 *
 * The "Try again" action is `@zanix/space-ui`'s real `Button` — never a bare `<button>` — the same
 * "generated code composes this package's own accessible primitives" convention every other
 * generator/scaffold template already follows (`getSpaceUiEntry`, same as `space-welcome.ts`/
 * `space-population.ts`). `getProjectRenderer` (`generate/shared/project.ts`) resolves which entry
 * point a real, existing project needs — this command reads an EXISTING project's own declared
 * renderer, never assumes one.
 *
 * The root element always carries `data-space='error'` — the stable attribute both `--theme
 * default`'s and `--theme astronaut`'s own `[data-space='error']` CSS rule already targets
 * (`space-theme.ts`/`space-astronaut.ts`), giving this fallback the same centered, margined
 * container either theme already ships for it. `theme` (`getProjectTheme`, `generate/shared/
 * project.ts`) only ever changes the COPY, resolved via {@linkcode resolveThemedCopy} against
 * {@linkcode THEMED_ERROR_TITLE}: `'astronaut'` gets a short, space-flavored message matching that
 * theme's visual identity; any theme with no entry in that table (including `undefined`, no theme
 * installed) keeps {@linkcode DEFAULT_ERROR_TITLE}. Adding a future theme's own fallback copy is a
 * one-line addition to {@linkcode THEMED_ERROR_TITLE} — never a new branch here.
 *
 * **`messageLangs`** (`getProjectMessageLangs`, `generate/shared/project.ts`) — `undefined`/empty
 * for a project with no `messages/` directory at all keeps the plain, hardcoded-English template
 * unchanged. When the project HAS one, the generated file wraps its content in `IntlProvider`/
 * `useIntl` instead, reading `ErrorBoundaryProps.messages` (never calling `loadMessages` itself —
 * see that field's own doc for why it's already resolved) and formatting through two catalog keys,
 * {@linkcode ERROR_TITLE_KEY}/{@linkcode ERROR_TRY_AGAIN_KEY} — the exact keys
 * {@linkcode errorCatalogKeys} seeds into every discovered lang's own `index.json` (via
 * `mergeMessageKeys`, `generate/shared/messages-merge.ts`) so `formatMessage(...)` never reads
 * back a key the catalog doesn't have yet. The thrown `error` itself is never part of the catalog
 * — it's live, per-request data, not a translatable string.
 */

/** Theme-specific title fallback copy — keyed by {@linkcode ThemeName}, missing entries (any theme
 * not listed, or no theme at all) fall back to {@linkcode DEFAULT_ERROR_TITLE}. Used verbatim for
 * the plain (non-i18n) template, and as the English catalog value for {@linkcode errorCatalogKeys}
 * when the project has `messagesDir`. */
const THEMED_ERROR_TITLE: Partial<Record<ThemeName, string>> = {
  astronaut: '🛰️ Houston, we have a problem.',
}
const DEFAULT_ERROR_TITLE = 'Something went wrong:'

/** Spanish counterpart to {@linkcode THEMED_ERROR_TITLE}/{@linkcode DEFAULT_ERROR_TITLE} — seeded
 * only into a discovered `messages/es/index.json`; every other lang folder (including `default`,
 * `--template population`'s own implicit-lang convention) gets the English value instead, the same
 * "human-authored, translate later" posture any other newly-added catalog key has. */
const THEMED_ERROR_TITLE_ES: Partial<Record<ThemeName, string>> = {
  astronaut: '🛰️ Houston, tenemos un problema.',
}
const DEFAULT_ERROR_TITLE_ES = 'Algo salió mal:'

export const ERROR_TITLE_KEY = 'error/title'
export const ERROR_TRY_AGAIN_KEY = 'error/tryAgain'

/** The catalog keys {@linkcode errorTemplate}'s own translated variant reads via `formatMessage`,
 * for one lang folder — passed to `mergeMessageKeys` once per lang `getProjectMessageLangs` finds. */
export function errorCatalogKeys(
  theme: ThemeName | undefined,
  lang: string,
): Record<string, string> {
  return lang === 'es'
    ? {
      [ERROR_TITLE_KEY]: resolveThemedCopy(theme, THEMED_ERROR_TITLE_ES, DEFAULT_ERROR_TITLE_ES),
      [ERROR_TRY_AGAIN_KEY]: 'Intentar de nuevo',
    }
    : {
      [ERROR_TITLE_KEY]: resolveThemedCopy(theme, THEMED_ERROR_TITLE, DEFAULT_ERROR_TITLE),
      [ERROR_TRY_AGAIN_KEY]: 'Try again',
    }
}

/** `routes/<route-path>/error.tsx` */
export const errorTemplate = (
  pascalName: string,
  renderer?: RendererName,
  theme?: ThemeName,
  messageLangs?: string[],
): string => {
  const spaceUiEntry = getSpaceUiEntry(renderer)

  if (!messageLangs?.length) {
    const title = resolveThemedCopy(theme, THEMED_ERROR_TITLE, DEFAULT_ERROR_TITLE)

    return `import type { ErrorBoundaryProps } from '@zanix/space'
import { Button } from '${spaceUiEntry}'

export default function ${pascalName}Error({ error, reset }: ErrorBoundaryProps) {
  return (
    <div data-space='error'>
      <p>${title}</p>
      <p>{String(error)}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
`
  }

  const messagesType = getIntlMessagesTypeName(renderer)

  return `import type { ErrorBoundaryProps } from '@zanix/space'
import { Button, IntlProvider, useIntl } from '${spaceUiEntry}'
import type { ${messagesType} } from '${spaceUiEntry}'

function ${pascalName}ErrorContent(
  { error, reset }: Pick<ErrorBoundaryProps, 'error' | 'reset'>,
) {
  const { formatMessage } = useIntl()

  return (
    <div data-space='error'>
      <p>{formatMessage('${ERROR_TITLE_KEY}')}</p>
      <p>{String(error)}</p>
      <Button onClick={reset}>{formatMessage('${ERROR_TRY_AGAIN_KEY}')}</Button>
    </div>
  )
}

// \`messages\` (\`ErrorBoundaryProps.messages\`) is already resolved/awaited by the time this
// component runs — never call \`loadMessages()\` here. \`params.lang\` is this segment's own
// resolved route param; falls back to \`'en'\` for an app with no \`/[lang]/...\` routing at all.
export default function ${pascalName}Error({ error, reset, params, messages }: ErrorBoundaryProps) {
  return (
    <IntlProvider locale={params.lang ?? 'en'} messages={(messages ?? {}) as ${messagesType}}>
      <${pascalName}ErrorContent error={error} reset={reset} />
    </IntlProvider>
  )
}
`
}
