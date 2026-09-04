/**
 * Boilerplate for `zanix generate layout <route-path>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Two shapes, because a root layout and a nested one are genuinely different things:
 *
 * - **A nested layout** wraps a section of the app. It receives `children` and renders whatever
 *   chrome that section needs.
 * - **A ROOT layout** (directly under `routesDir`) additionally OWNS THE DOCUMENT — `<html>`,
 *   `<head>` and `<body>`. `@zanix/space` uses it in place of its own default document shell, and
 *   deliberately does not verify that it actually renders one (the same contract Next.js's App
 *   Router uses). Generating the nested shape at the root therefore replaced a valid document with
 *   a bare `<div>`: no doctype, no `lang`, no charset, no viewport. That was a silent regression
 *   introduced by this framework's own tooling, which is what {@linkcode rootLayoutTemplate} fixes.
 *
 * **A root layout is never required to cooperate with head management.** It renders no `<title>`,
 * no `<meta>` from props, and receives no head-related prop of any kind — under either renderer.
 * `@zanix/space` places the resolved head into the document itself (React through its own hoisting,
 * Preact through `placeHeadMarkup`), so these templates are complete as written. An earlier design
 * did pass a `headExtras` prop that a Preact root layout had to render for the document to carry any
 * metadata at all; nothing in these templates depends on that any more, and nothing should be added
 * that does.
 */

/** `routes/<route-path>/layout.tsx` — a NESTED layout. Renderer-independent: it renders no document
 * structure, so nothing in it differs between React and Preact. */
export const layoutTemplate = (pascalName: string): string =>
  `import type { LayoutProps } from '@zanix/space'

export default function ${pascalName}Layout({ children }: LayoutProps) {
  return <div>{children}</div>
}
`

/**
 * `routes/layout.tsx` — the ROOT layout, which owns the document.
 *
 * `lang`, the encoding declaration and a zoomable viewport are all present deliberately:
 *
 * - `lang` is WCAG 3.1.1 (Level A) — the document's language must be programmatically determinable.
 * - `<meta charSet>` is a secondary declaration; the framework already declares the encoding at the
 *   protocol level on every response (`content-type: text/html; charset=utf-8`), which is what
 *   actually satisfies the HTML Standard. This covers the cases a header does not.
 * - The viewport carries no `user-scalable=no` and no `maximum-scale` below 2. Either would be a
 *   real WCAG 1.4.4 (AA) failure under ACT rule b4f0c3 — this is the one document-level default
 *   where getting it wrong breaks accessibility conformance outright.
 *
 * @param renderer - The project's renderer, DERIVED from `compilerOptions.jsxImportSource` (see
 * `getProjectRenderer`) — the compile-time projection of the one place a project actually selects a
 * renderer, `defineSpaceApp({ renderer })`. There is no separate config field for this, deliberately:
 * a second knob could drift away from both. Only the type import differs between the two outputs —
 * Preact's `LayoutProps` needs its own `ComponentChildren` as the children type, per `LayoutProps`'s
 * own documented generic.
 */
export const rootLayoutTemplate = (
  pascalName: string,
  renderer: 'react' | 'preact',
): string => {
  const props = renderer === 'preact'
    ? `import type { ComponentChildren } from 'preact'
import type { LayoutProps } from '@zanix/space'

export default function ${pascalName}Layout(
  { children }: LayoutProps<ComponentChildren>,
) {`
    : `import type { LayoutProps } from '@zanix/space'

export default function ${pascalName}Layout({ children }: LayoutProps) {`

  return `${props}
  return (
    <html lang='en'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </head>
      <body>{children}</body>
    </html>
  )
}
`
}
