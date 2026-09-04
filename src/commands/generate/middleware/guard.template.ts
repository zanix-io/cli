/**
 * Boilerplate for `zanix generate middleware <name> --kind guard`.
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * Shape verified against `@zanix/server`'s own real source: `modules/infra/middlewares/decorators/
 * {assembly,guard}.ts` and `typings/middlewares.ts`. `defineMiddlewareDecorator('guard', middleware)`
 * is the same primitive `@Guard`'s own sugar decorator wraps internally — used directly here (per
 * `assembly.ts`'s own JSDoc example) so `command.ts` can drive all three middleware kinds (`guard`/
 * `pipe`/`interceptor`) through one shared codegen shape, keyed only by the `type` discriminant,
 * instead of importing a separate sugar decorator per kind. `GuardContext` (not the plain
 * `HandlerContext` a pipe/interceptor gets) is what a guard's middleware function actually receives
 * — it extends `HandlerContext` with `interactors`/`providers`/`connectors` getters, verified
 * against `typings/middlewares.ts`'s own `GuardContext`/`MiddlewareGuard` types. Applying the
 * generated decorator at class level guards every method on that class; at method level it guards
 * just that one handler — both forms are handled identically by `defineMiddlewareDecorator` itself
 * (`assembly.ts`'s own `context?.kind === 'class'` branch), so this shell doesn't need to pick one.
 */

/** `middlewares/<name>.guard.ts` */
export const guardMiddlewareTemplate = (pascalName: string): string =>
  `import type { GuardContext, GuardResponse } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * A guard runs before the handler (and before any pipes/interceptors), deciding whether the
 * request is allowed to proceed. It can short-circuit the request by returning a \`response\`
 * (e.g. a 401/403), and/or attach extra \`headers\` to the eventual response. Unlike a pipe/
 * interceptor, a guard's context (\`GuardContext\`) also exposes \`interactors\`/\`providers\`/
 * \`connectors\` getters.
 *
 * Apply this on a handler method (guards just that handler) or on a whole class (guards every
 * method on it), e.g.:
 * \`@${pascalName}Guard public async someHandler(ctx: HandlerContext) { ... }\`
 */
export const ${pascalName}Guard = defineMiddlewareDecorator(
  'guard',
  (_ctx: GuardContext): GuardResponse => {
    // Decide whether to allow the request here, e.g.:
    // if (!_ctx.session) return { response: new Response('Unauthorized', { status: 401 }) }
    return {}
  },
)
`
