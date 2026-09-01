/**
 * Boilerplate for `zanix generate middleware <name> --kind pipe`.
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * Shape verified against `@zanix/server`'s own real source: `modules/infra/middlewares/decorators/
 * {assembly,pipe}.ts` and `typings/middlewares.ts`. Same `defineMiddlewareDecorator(type,
 * middleware)` primitive as `guard.template.ts` — see that file's own header for why this is used
 * directly instead of `@Pipe`'s sugar wrapper. A pipe's middleware function receives the plain
 * `HandlerContext` (no `interactors`/`providers`/`connectors` getters — those are `GuardContext`-only,
 * per `typings/middlewares.ts`'s own `MiddlewarePipe` vs `MiddlewareGuard` signatures) and returns
 * `void | Promise<void>` — it never returns a `Response` directly; short-circuiting a request from a
 * pipe means throwing instead (the framework's own error handling turns that into a `Response`).
 */

/** `middlewares/<name>.pipe.ts` */
export const pipeMiddlewareTemplate = (pascalName: string): string =>
  `import type { HandlerContext } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * A pipe runs before the handler, for validating, sanitizing, or transforming incoming data. It
 * doesn't return a \`Response\` directly — throw instead to short-circuit the request (the thrown
 * error is later caught and turned into a \`Response\` by the final interceptor / global error
 * handler).
 *
 * Apply this on a handler method (pipes just that handler) or on a whole class (pipes every method
 * on it), e.g.:
 * \`@${pascalName}Pipe public async someHandler(ctx: HandlerContext) { ... }\`
 */
export const ${pascalName}Pipe = defineMiddlewareDecorator(
  'pipe',
  (_ctx: HandlerContext): void => {
    // Validate, sanitize, or transform incoming data here.
  },
)
`
