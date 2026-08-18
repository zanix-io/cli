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
export function assertValidRenderer(value: string | undefined): 'react' | 'preact' {
  if (value === undefined || value === 'react') return 'react'
  if (value === 'preact') return 'preact'

  throw new Error(
    `Unsupported renderer '${value}'. Supported renderers: react, preact.`,
  )
}
