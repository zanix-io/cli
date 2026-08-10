/**
 * Boilerplate for `zanix generate comet <name>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Content matches `@zanix/space`'s own real, current `defineComet` contract exactly — verified
 * against that package's source, not assumed: a leading `'use comet'` directive (how
 * `cometPlugin` finds this file at build time), the wrapped component exported under its own name
 * (`defineComet` throws at runtime otherwise — it needs a real name to re-import after the
 * client build), and `defineComet(Component, import.meta.url)` with both arguments, always
 * written at this exact call site.
 */

/** `comets/<name>.comet.tsx` */
export const cometTemplate = (pascalName: string): string =>
  `'use comet'

import { defineComet } from '@zanix/space'

export function ${pascalName}() {
  return <div>${pascalName}</div>
}

export default defineComet(${pascalName}, import.meta.url)
`
