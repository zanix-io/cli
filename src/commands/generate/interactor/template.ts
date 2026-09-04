/**
 * Boilerplate for `zanix generate interactor <name>`.
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * Content verbatim (shape/imports) from `@zanix/server`'s own real `src/templates/src/server/
 * interactors/service.interactor.ts` (this repo's previous single source of truth for this shape,
 * retired in favor of this generator), minus the RTO cross-reference — deliberately does not
 * reference a specific `<Name>RTO`, same reason `handler/template.ts` deliberately does not
 * reference an `Interactor`: that's a separate, optional artifact this command has no way of
 * knowing was already generated for this same entity. Wire it in by hand once it exists.
 */

/** `interactors/<name>.interactor.ts` */
export const interactorTemplate = (pascalName: string): string =>
  `/**
 * An interactor holds business logic and is the bridge between a handler (HTTP/socket/GraphQL)
 * and the data layer (connectors, providers/repositories).
 *
 * **How to use**: reach any dependency — a repository, a connector, another interactor — through
 * \`this.providers.get(SomeRepository)\`/\`this.connectors.get(SomeConnector)\`/
 * \`this.interactors.get(SomeInteractor)\`. There is no single-slot \`Connector\`/\`Provider\`
 * decorator option: reach for the generic getters even when this interactor has just one
 * dependency. Once a matching \`<Entity>RTO\` exists (\`zanix generate rto\`), wire it in by hand,
 * e.g.: \`public list(search: ${pascalName}RTO) { ... }\`.
 */

import { Interactor, ZanixInteractor } from '@zanix/server'

@Interactor()
export class ${pascalName}Service extends ZanixInteractor {
  public list() {
    // Delegate to a provider/repository here, e.g.:
    // return this.providers.get(${pascalName}Repository).findAll()
    return []
  }
}
`
