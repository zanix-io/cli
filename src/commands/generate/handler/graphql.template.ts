/**
 * Boilerplate for `zanix generate handler <name> --type graphql`.
 *
 * Embedded as a string-template function for the same reason as `rest.template.ts` (`zanix build`
 * bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `Resolver`/`ZanixResolver`/`Query` source
 * (`modules/infra/handlers/graphql/{decorators/base,decorators/query,base}.ts`) — `@Resolver`
 * mirrors `@Controller` exactly (same `GenericHandlerOptions & {prefix}` shape), and `@Query`'s
 * own doc-comment example is the basis for this shell. Deliberately does not reference an
 * `Interactor`, same reasoning as `rest.template.ts`.
 */

/** `handlers/<name>.resolver.ts` */
export const graphqlHandlerTemplate = (
  pascalName: string,
  kebabName: string,
): string =>
  `import { Query, Resolver, type HandlerContext, ZanixResolver } from '@zanix/server'

/**
 * Resolver for ${pascalName}.
 *
 * @class
 * @extends ZanixResolver
 */
@Resolver({ prefix: '${kebabName}' })
export class ${pascalName}Resolver extends ZanixResolver {
  @Query({ output: '${pascalName}' })
  public list(_ctx: HandlerContext) {
    // Once wired to an Interactor (see this file's header comment), delegate the actual work to
    // it instead, e.g.: return this.interactor.list()
    return []
  }
}
`
