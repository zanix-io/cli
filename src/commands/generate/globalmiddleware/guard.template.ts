/**
 * Boilerplate for `zanix generate globalmiddleware <name> --kind guard`.
 *
 * Embedded as a string-template function for the same reason as `pipe.template.ts` (sibling file) —
 * see that file's own doc for the shared rationale (`.dist/app.mjs` bundling, the
 * `MiddlewareGlobalGuard` intersection typing, the named-function-expression `getTargetKey` detail).
 *
 * Shape verified against `@zanix/server`'s own real source: `modules/infra/middlewares/defs/guards.ts`'s own
 * `registerGlobalGuard` and its own JSDoc example, and `typings/middlewares.ts`'s own
 * `MiddlewareGlobalGuard`/`GuardContext`/`GuardResponse` types. Unlike a global pipe/interceptor
 * (plain `GlobalMidContext`), a global guard's context is `GuardContext` — the SAME richer context
 * (`interactors`/`providers`/`connectors` getters) a per-handler guard already gets, verified
 * against `middleware/guard.template.ts`'s own already-established `GuardContext` usage.
 */

/** `shared/middlewares/<name>.guard.defs.ts` */
export const globalGuardTemplate = (pascalName: string): string =>
  `import type { GuardResponse, MiddlewareGlobalGuard } from '@zanix/server'

import { registerGlobalGuard } from '@zanix/server'

/**
 * A global guard runs before any pipe/interceptor and before the handler, across every request
 * matching \`exports.server\` below — unlike a per-handler guard (\`zanix generate middleware --kind
 * guard\`), it's never applied by hand; \`registerGlobalGuard\` registers it for the whole app the
 * moment this file is auto-discovered. It can short-circuit the request by returning a \`response\`
 * (e.g. a 401/403), and/or attach extra \`headers\` to the eventual response.
 */
const ${pascalName}Guard: MiddlewareGlobalGuard = function ${pascalName}Guard(
  _ctx,
): GuardResponse {
  // Decide whether to allow the request here, e.g.:
  // if (!_ctx.locals.session) return { response: new Response('Unauthorized', { status: 401 }) }
  return {}
}

${pascalName}Guard.exports = {
  // Restrict to specific server types here, e.g. ['rest'] — defaults to every server type.
  server: ['all'],
}

registerGlobalGuard(${pascalName}Guard)
`
