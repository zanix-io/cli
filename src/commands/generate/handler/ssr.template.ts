/**
 * Boilerplate for `zanix generate handler <name> --type ssr`.
 *
 * Embedded as a string-template function for the same reason as `rest.template.ts` (`zanix build`
 * bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `SsrController`/`ZanixSsrController` source
 * (`modules/infra/handlers/ssr/{decorators/base,base}.ts`) — per that file's own doc comment, SSR
 * shares the exact same `@Get`/`@Post`/`@Patch`/`@Put`/`@Delete`/`@Request` method decorators REST
 * controllers use (they carry no server-type of their own), so this shell mirrors
 * `rest.template.ts` almost exactly; only the class/import/decorator names differ. The real
 * `SsrController` doc-comment example returns JSX (`renderToResponse(<Page />)`) — this shell
 * deliberately stays plain `.ts` (no JSX) to match every other generator's shell convention; wire
 * in your actual rendering call by hand.
 */

/** `handlers/<name>.ssr.ts` */
export const ssrHandlerTemplate = (pascalName: string, kebabName: string): string =>
  `import { Get, SsrController, type HandlerContext, ZanixSsrController } from '@zanix/server'

/**
 * SSR controller for ${pascalName}.
 *
 * @class
 * @extends ZanixSsrController
 */
@SsrController({ prefix: '${kebabName}' })
export class ${pascalName}Controller extends ZanixSsrController {
  @Get()
  public list(_ctx: HandlerContext) {
    // Render and return a response here, e.g.: return renderToResponse(<Page />)
    return []
  }
}
`
