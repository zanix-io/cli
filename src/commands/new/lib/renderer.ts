/** The two renderers `zanix new space`/`spacecraft` support — the single source every
 * renderer-aware generated template (`space.ts`, `space-icons.ts`, `space-welcome.ts`,
 * `space-astronaut.ts`) types its own `renderer` parameter against, instead of each re-declaring
 * the same `'react' | 'preact'` union independently. */
export type RendererName = 'react' | 'preact'

/**
 * Validates `--renderer`'s own raw CLI value — shared between `zanix new space` and `zanix new
 * spacecraft` (the only two project types with a renderer at all), same "throw a plain Error, let
 * the caller's own try/catch route it through `this.throw`" convention `planHandler`'s own
 * `--type` validation already establishes (`commands/generate/handler/command.ts`).
 *
 * `undefined` (the flag omitted entirely) defaults to `'react'` — identical in every respect to
 * passing `--renderer=react` explicitly, matching `defineSpaceApp({ renderer })`'s own doc in
 * `@zanix/space`.
 *
 * @throws {Error} If `value` is neither `undefined`, `'react'`, nor `'preact'`.
 */
export function assertValidRenderer(value: string | undefined): RendererName {
  if (value === undefined || value === 'react') return 'react'
  if (value === 'preact') return 'preact'

  throw new Error(
    `Unsupported renderer '${value}'. Supported renderers: react, preact.`,
  )
}

/**
 * Resolves `@zanix/space-ui`'s own renderer-specific entrypoint — `.` (React) vs `./preact` — the
 * ONE place every generated import of `@zanix/space-ui` picks between them, so a future renderer,
 * or a future `@zanix/space-ui` entrypoint change, only ever needs updating here rather than in
 * every template that happens to import from that package (`space-icons.ts`'s own
 * `getCatalogIconWrapperTemplate` established this exact selection first; `space-welcome.ts`/
 * `space-astronaut.ts` now reuse it instead of re-declaring the same ternary a third and fourth
 * time).
 */
export function getSpaceUiEntry(renderer?: RendererName): string {
  return renderer === 'preact' ? '@zanix/space-ui/preact' : '@zanix/space-ui'
}

/**
 * Resolves the hooks entrypoint a generated component reaches for `useState`/`useEffect`-style
 * React hooks from — plain `'react'` for the React renderer, `'preact/hooks'` for Preact (never
 * `preact/compat`, same "two independent bindings" rule `@zanix/space-ui`'s own `IntlProvider`/
 * `useIntl` already follow — see `space-i18n-and-population`). Used wherever generated app code
 * (not `@zanix/space-ui` itself) needs a hook directly, e.g. `space-astronaut.ts`'s own comet demo.
 */
export function getHooksEntry(renderer?: RendererName): string {
  return renderer === 'preact' ? 'preact/hooks' : 'react'
}

/**
 * Resolves the exported name `@zanix/space-ui`'s own messages type carries for a given renderer — a
 * real, confirmed naming asymmetry in that package itself, not a typo: its bare (React) entrypoint
 * exports the type as `Messages`, its `/preact` entrypoint re-exports the SAME underlying
 * `intl/formatter.ts` type as `IntlMessages` instead. Generated code that types a `loadMessages(...)`
 * result (`space-population.ts`'s own page template) needs the renderer-correct name to type-check —
 * this is the one place that asymmetry gets resolved, so a future `@zanix/space-ui` change only
 * needs updating here.
 */
export function getIntlMessagesTypeName(renderer?: RendererName): string {
  return renderer === 'preact' ? 'IntlMessages' : 'Messages'
}
