/**
 * Boilerplate for `zanix generate handler <name>` (default `--type rest`).
 *
 * Embedded as a string-template function (not read from a separate file) for the same reason as
 * `seeder/template.ts`/`repository/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * One of 4 handler-type templates (`rest`/`graphql`/`socket`/`ssr`) selected by `command.ts`'s
 * `--type` option — see that file's `HANDLER_TYPES` table for the full picture. Deliberately does
 * not reference an `Interactor` — that's a separate, optional artifact
 * (`zanix generate interactor <name>`), and `@Controller`/`ZanixController` both work with none
 * declared (`Interactor` defaults to `never`). Wire one in by hand once it exists:
 * `@Controller({ prefix: '...', Interactor: XService })` +
 * `extends ZanixController<XService>` + `this.interactor` inside each method.
 */

/** `handlers/<name>.handler.ts` */
export const handlerTemplate = (pascalName: string, kebabName: string): string =>
  `import { Controller, Get, type HandlerContext, ZanixController } from '@zanix/server'

/**
 * Controller for ${pascalName}.
 *
 * @class
 * @extends ZanixController
 */
@Controller({ prefix: '${kebabName}' })
export class ${pascalName}Controller extends ZanixController {
  @Get()
  public list(_ctx: HandlerContext) {
    // Once wired to an Interactor (see this file's header comment), delegate the actual work to
    // it instead, e.g.: return this.interactor.list()
    return []
  }
}
`
