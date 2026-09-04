/**
 * Boilerplate for `zanix generate globalmiddleware <name> --kind pipe`.
 *
 * Embedded as a string-template function for the same reason as `handler/rest.template.ts`/
 * `middleware/pipe.template.ts`: `zanix build` bundles this command's code into a single
 * `.dist/app.mjs` output by default.
 *
 * Shape verified against `@zanix/server`'s own real source: `modules/infra/middlewares/defs/pipes.ts`'s own
 * `registerGlobalPipe` and its own JSDoc example, and `typings/middlewares.ts`'s own
 * `MiddlewareGlobalPipe`/`GlobalMidContext` types.
 *
 * `registerGlobalPipe` is the STRUCTURALLY DISTINCT counterpart to `middleware`'s own
 * `defineMiddlewareDecorator('pipe', ...)`: that one produces a decorator applied explicitly to one
 * handler/class; this one registers a DSL-style, app-wide pipe that runs on every matching request
 * across the server types listed in `exports.server` (`'all'` by default) — never applied anywhere
 * by hand, discovered automatically the same way a `job`/`dlqprocessor` `.defs.ts` file is (see
 * `command.ts`'s own doc for the full auto-discovery mechanism/verification).
 *
 * `MiddlewareGlobalPipe` is an intersection of a call signature AND `{ exports?: {...} }` — the
 * generated shell types the exported `const` against that intersection (not a plain inferred
 * function type) specifically so the later `.exports = {...}` assignment type-checks under this
 * project's own `strict`/`noImplicitAny` compiler options, exactly the pattern
 * `registerGlobalPipe`'s own JSDoc example uses. A named function expression (not an anonymous
 * arrow) is used deliberately — `registerGlobalPipe`'s internal `getTargetKey(target)` call keys
 * off the function's own `.name`, and a named expression gives it one predictably (an anonymous
 * arrow assigned to a `const` also gets an inferred `.name`, but the named-function-expression form
 * mirrors the real JSDoc example verbatim, so this shell stays visibly traceable to it).
 */

/** `shared/middlewares/<name>.pipe.defs.ts` */
export const globalPipeTemplate = (pascalName: string): string =>
  `import type { MiddlewareGlobalPipe } from '@zanix/server'

import { registerGlobalPipe } from '@zanix/server'

/**
 * A global pipe runs before the handler, across every request matching \`exports.server\` below —
 * unlike a per-handler pipe (\`zanix generate middleware --kind pipe\`), it's never applied by hand;
 * \`registerGlobalPipe\` registers it for the whole app the moment this file is auto-discovered.
 * It never returns a \`Response\` directly — throw to short-circuit the request instead.
 */
const ${pascalName}Pipe: MiddlewareGlobalPipe = function ${pascalName}Pipe(ctx) {
  // Validate, sanitize, or transform incoming data here, e.g.:
  // console.log('Incoming request:', ctx.url.pathname)
}

${pascalName}Pipe.exports = {
  // Restrict to specific server types here, e.g. ['rest'] — defaults to every server type.
  server: ['all'],
}

registerGlobalPipe(${pascalName}Pipe)
`
