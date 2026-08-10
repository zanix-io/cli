/**
 * Boilerplate for `zanix generate layout <route-path>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Matches `@zanix/space`'s own real, current `layout.tsx` convention: a plain default-exported
 * function component receiving `LayoutProps` (`children`/`params`) — never a decorator, never
 * registered on the class itself; `loadRoutes()` discovers it purely from its file location.
 */

/** `routes/<route-path>/layout.tsx` */
export const layoutTemplate = (pascalName: string): string =>
  `import type { LayoutProps } from '@zanix/space'

export default function ${pascalName}Layout({ children }: LayoutProps) {
  return <div>{children}</div>
}
`
