/**
 * Boilerplate for `zanix generate page <route-path>`.
 *
 * Embedded as a string-template function for the same reason as every other generator's own
 * `template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs` output.
 *
 * Matches `@zanix/space`'s own real, current `SpacePageController`/`Page()` contract: `@Page()`
 * with no argument (infers the route from this file's own location under `routesDir`, which is
 * exactly where this command writes it — an explicit path argument would be redundant), and
 * `component` as a class-field arrow-compatible assignment (a plain function reference is valid
 * here too, matching `@zanix/space`'s own scaffold example in `cli`'s `new space` templates).
 */

/** `routes/<route-path>/page.tsx` */
export const pageTemplate = (pascalName: string): string =>
  `import { Page, SpacePageController } from '@zanix/space'

function ${pascalName}View() {
  return <p>${pascalName}</p>
}

@Page()
export default class ${pascalName}Page extends SpacePageController {
  component = ${pascalName}View
}
`
