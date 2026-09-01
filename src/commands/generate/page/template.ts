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
 * Both `head` and `component` carry an explicit `public` modifier — the generated project's own
 * `deno-zanix-plugin/require-access-modifier` lint rule has no auto-fix, so an implicit modifier
 * would leave every scaffolded page permanently failing `deno lint`. `head` additionally needs
 * `override` (`SpacePageController.head` is a concrete, non-abstract member, so the generated
 * project's own `strict: true` — which enables `noImplicitOverride` on the TypeScript version
 * this CLI targets — rejects overriding it without the keyword; confirmed with a real `deno
 * check`, not assumed). `component` implements an `abstract` member, which TypeScript never
 * requires `override` for, but it carries the keyword too anyway, matching every real page
 * fixture in `@zanix/space`'s own test suite.
 *
 * **Emits a `static head` and an `<h1>`, and these are scaffolding conventions — not requirements.**
 * The distinction is deliberate and worth stating where the code lives:
 *
 * - `static head` exists because a document with no `<title>` is genuinely non-conforming (the HTML
 *   Standard's `head` content model requires exactly one) and fails WCAG 2.4.2. Before this, the
 *   generated page produced a document with no title at all unless some layout happened to supply
 *   one — the framework's own default path violated a real requirement.
 * - The `<h1>` is only a good starting point for a page. `@zanix/space` does NOT require a document
 *   to have one: it is not an HTML requirement, not a WCAG success criterion, and Google Search
 *   documents no requirement about heading counts. The build reports a missing `<h1>` as a
 *   non-normative warning, and a page without one is perfectly valid. Generating one here must never
 *   be read as making it part of the contract — generator convention is not the validation contract.
 */

/** `routes/<route-path>/page.tsx` */
export const pageTemplate = (pascalName: string): string =>
  `import { Page, SpacePageController } from '@zanix/space'

function ${pascalName}View() {
  return (
    <main>
      <h1>${pascalName}</h1>
    </main>
  )
}

@Page()
export default class ${pascalName}Page extends SpacePageController {
  public static override head = { title: '${pascalName}' }

  public override component = ${pascalName}View
}
`
