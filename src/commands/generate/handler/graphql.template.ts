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
 *
 * `ZanixResolver`/`Resolver`/`Query`/`Mutation`/`Request` live at their own `@zanix/server/graphql`
 * subpath, not the package root — the real `graphql` (`graphql-js`) npm dependency they pull in
 * stays behind that subpath only, so importing this subpath is the only way to reach it; any code
 * that never imports `@zanix/server/graphql` never resolves `graphql-js` at all (see that
 * subpath's own module doc). `HandlerContext` stays a root import — it's a plain type, shared by
 * every handler kind, never moved.
 *
 * Unlike `rest.template.ts`/`ssr.template.ts` (whose real dispatch, `webserver/helpers/routes.ts`'s
 * `processedHandler`, calls the handler method with a single `ctx` argument), every `@Query`/
 * `@Mutation` method is always invoked with TWO arguments, `(payload, ctx)`, regardless of whether
 * the query declares an `input` — see `modules/infra/handlers/graphql/decorators/assembly.ts`'s
 * `handler.call(instance, payload, ctx)`. Since this shell's `@Query` declares no `input`, the
 * `payload` graphql-js actually passes at runtime is always an empty args object (never
 * `undefined`), hence the `Record<string, never>` annotation — the same "empty object" shape
 * `@zanix/app`'s own real typings (`EventsDeclaration = Record<string, Record<string, never>>`)
 * use elsewhere in the ecosystem for this exact case, not a guessed `unknown`.
 */

/** `handlers/<name>.resolver.handler.ts` */
export const graphqlHandlerTemplate = (
  pascalName: string,
  kebabName: string,
): string =>
  `import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'
import type { HandlerContext } from '@zanix/server'

/**
 * Resolver for ${pascalName}.
 *
 * @class
 * @extends ZanixResolver
 */
@Resolver({ prefix: '${kebabName}' })
export class ${pascalName}Resolver extends ZanixResolver {
  @Query({ output: '${pascalName}' })
  public list(_payload: Record<string, never>, _ctx: HandlerContext) {
    // Once wired to an Interactor (see this file's header comment), delegate the actual work to
    // it instead, e.g.: return this.interactor.list()
    return []
  }
}
`
