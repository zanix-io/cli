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
 *
 * Imports `defineComet` from `@zanix/space/comet`, never the root `@zanix/space` — that package's
 * own root barrel deliberately does not re-export it (a real browser bundler resolving the root
 * barrel as a whole would otherwise pull server/dev-only code into a Comet's own client bundle).
 */

/** `comets/<name>.comet.tsx` */
export const cometTemplate = (pascalName: string): string =>
  `'use comet'

import { defineComet } from '@zanix/space/comet'

export function ${pascalName}() {
  return <div>${pascalName}</div>
}

export default defineComet(${pascalName}, import.meta.url)
`
