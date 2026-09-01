/**
 * Boilerplate for `zanix generate connector <name> --slot rest`.
 *
 * Embedded as a string-template function for the same reason as `generic.template.ts` (`zanix
 * build` bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `RestClient` source (`modules/infra/
 * connectors/core/rest.ts`) — `http.get/post/put/patch/delete/head/options`, JSON parsing,
 * default headers, conditional `ETag` caching, and structured errors (`RestClientError`) all come
 * from the base class; a subclass only ever adds its own domain methods on top.
 *
 * Unlike `database`/`cache:<subtype>`, `'rest'` is NOT a real core connector slot `@zanix/server`
 * registers against (see `command.ts`'s own `SLOTS_REQUIRING_DATAMASTER` doc) — it's a plain,
 * self-sufficient connector to an external REST API, so the decorator stays bare `@Connector()`,
 * same as `generic.template.ts`'s own no-`--slot` shape, never `@Connector({ slot: 'rest' })`.
 * `RestClient` has no persistent connection to establish/tear down either (`initialize`/`close`
 * are no-ops in the base class), so this template doesn't override them.
 */

/** `connectors/<name>.connector.ts` */
export const restConnectorTemplate = (pascalName: string): string =>
  `import { Connector, RestClient } from '@zanix/server'

/**
 * REST client for ${pascalName}.
 *
 * @class
 * @extends RestClient
 */
@Connector()
export class ${pascalName}Connector extends RestClient {
  constructor() {
    super({ baseUrl: 'https://api.example.com' })
  }

  public getExample(id: string) {
    return this.http.get(\`/example/\${id}\`)
  }
}
`
