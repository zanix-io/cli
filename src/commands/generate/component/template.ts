/**
 * Boilerplate for `zanix generate component <name>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * A plain, presentational function component — no `'use comet'` directive, no `defineComet` wrapper,
 * no framework-provided props type (`@zanix/space` has nothing analogous to `LayoutProps`/
 * `ErrorBoundaryProps` for this shape, because it doesn't recognize this shape at all — see
 * `component/command.ts`'s own doc). Renderer-independent for the same reason `error`/`loading`
 * already are: it renders no document structure and receives no renderer-specific prop type, so
 * nothing in it differs between React and Preact.
 *
 * Deliberately minimal, the same "shell" contract `comet`/`loading` already use: a starting point
 * a developer immediately edits by hand (real props, real markup), not a fully-fledged example.
 */

/** `components/<name>.tsx` */
export const componentTemplate = (pascalName: string): string =>
  `export default function ${pascalName}() {
  return <div>${pascalName}</div>
}
`
