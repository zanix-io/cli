/**
 * Boilerplate for `zanix generate globalmiddleware <name> --kind interceptor`.
 *
 * Embedded as a string-template function for the same reason as `pipe.template.ts` (sibling file) —
 * see that file's own doc for the shared rationale (`.dist/app.mjs` bundling, the
 * `MiddlewareGlobalInterceptor` intersection typing, the named-function-expression `getTargetKey`
 * detail).
 *
 * Shape verified against `@zanix/server`'s own real source: `modules/infra/middlewares/defs/
 * interceptors.ts`'s own `registerGlobalInterceptor` and its own JSDoc example, and
 * `typings/middlewares.ts`'s own `MiddlewareGlobalInterceptor`/`GlobalMidContext` types.
 */

/** `shared/middlewares/<name>.interceptor.defs.ts` */
export const globalInterceptorTemplate = (pascalName: string): string =>
  `import type { MiddlewareGlobalInterceptor } from '@zanix/server'

import { registerGlobalInterceptor } from '@zanix/server'

/**
 * A global interceptor runs after the handler has already produced a \`Response\`, across every
 * request matching \`exports.server\` below — unlike a per-handler interceptor (\`zanix generate
 * middleware --kind interceptor\`), it's never applied by hand; \`registerGlobalInterceptor\`
 * registers it for the whole app the moment this file is auto-discovered. It must return a
 * \`Response\` (the original, or a replacement).
 */
const ${pascalName}Interceptor: MiddlewareGlobalInterceptor = function ${pascalName}Interceptor(
  _ctx,
  response,
) {
  // Modify, wrap, or observe the outgoing Response here, e.g.:
  // response.headers.set('X-Custom-Header', 'value')
  return response
}

${pascalName}Interceptor.exports = {
  // Restrict to specific server types here, e.g. ['rest'] — defaults to every server type.
  server: ['all'],
}

registerGlobalInterceptor(${pascalName}Interceptor)
`
