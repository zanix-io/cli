/**
 * Boilerplate for `zanix generate loading <route-path>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Matches `@zanix/space`'s own real, current `loading.tsx` convention: a plain, no-props,
 * default-exported function component — `loadRoutes()` discovers it purely from its file location,
 * the same way it discovers `layout.tsx`/`error.tsx`. Under `--renderer=preact`, this convention is
 * explicitly unsupported (Preact core has no `Suspense`) — `loadRoutes()` itself fails fast with a
 * clear message at registration time if a `loading.tsx` is present in a Preact project, so this
 * generator doesn't need to special-case the renderer: the failure, if any, happens where the
 * project's own renderer is already known, not here.
 */

/** `routes/<route-path>/loading.tsx` */
export const loadingTemplate = (pascalName: string): string =>
  `export default function ${pascalName}Loading() {
  return <p>Loading...</p>
}
`
