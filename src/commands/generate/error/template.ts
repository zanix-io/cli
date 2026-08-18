/**
 * Boilerplate for `zanix generate error <route-path>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Matches `@zanix/space`'s own real, current `error.tsx` convention exactly (verified against that
 * package's source, not assumed): a plain default-exported function component receiving
 * `ErrorBoundaryProps` (`error`/`reset`) — never a decorator, never registered on the page's class
 * itself; `loadRoutes()` discovers it purely from its file location, the same way it discovers
 * `layout.tsx`/`loading.tsx`.
 */

/** `routes/<route-path>/error.tsx` */
export const errorTemplate = (pascalName: string): string =>
  `import type { ErrorBoundaryProps } from '@zanix/space'

export default function ${pascalName}Error({ error, reset }: ErrorBoundaryProps) {
  return (
    <div>
      <p>Something went wrong: {String(error)}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
`
