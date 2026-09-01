/**
 * Boilerplate for `zanix generate middleware <name> --kind interceptor`.
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * Shape verified against `@zanix/server`'s own real source: `modules/infra/middlewares/decorators/
 * {assembly,interceptor}.ts` and `typings/middlewares.ts`. Same `defineMiddlewareDecorator(type,
 * middleware)` primitive as `guard.template.ts`/`pipe.template.ts` — see `guard.template.ts`'s own
 * header for why this is used directly instead of `@Interceptor`'s sugar wrapper. An interceptor's
 * middleware function receives the plain `HandlerContext` plus the handler's own `Response`, and
 * must return a `Response | Promise<Response>` (per `MiddlewareInterceptor`'s own signature in
 * `typings/middlewares.ts`) — it only runs once the handler has already produced a `Response`,
 * unlike a guard/pipe which both run beforehand.
 */

/** `middlewares/<name>.interceptor.ts` */
export const interceptorMiddlewareTemplate = (pascalName: string): string =>
  `import type { HandlerContext } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * An interceptor runs after the handler has already produced a \`Response\`, for modifying,
 * wrapping, or observing it (adding headers, logging, unifying the response format). It only runs
 * if the handler successfully returns a \`Response\` — it never runs if the handler throws.
 *
 * Apply this on a handler method (intercepts just that handler's response) or on a whole class
 * (intercepts every method's response), e.g.:
 * \`@${pascalName}Interceptor public async someHandler(ctx: HandlerContext) { ... }\`
 */
export const ${pascalName}Interceptor = defineMiddlewareDecorator(
  'interceptor',
  (_ctx: HandlerContext, response: Response): Response => {
    // Modify, wrap, or observe the outgoing Response here, e.g.:
    // response.headers.set('X-Custom-Header', 'value')
    return response
  },
)
`
