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
 * no-props, default-exported function component.
 */

/** `routes/not-found.tsx` */
export const notFoundTemplate = (): string =>
  `export default function NotFound() {
  return (
    <>
      <title>Page not found</title>
      <h1>404 — Page not found</h1>
    </>
  )
}
`
