/**
 * Boilerplate for `zanix generate connector <name> --slot graphql`.
 *
 * Embedded as a string-template function for the same reason as `generic.template.ts` (`zanix
 * build` bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `GraphQLClient` source (`modules/infra/
 * connectors/core/graphql.ts`) — `extends RestClient`, adding one `query(query, { variables,
 * request })` method that POSTs `{ query, variables }`; every `RestClient` concern (JSON parsing,
 * default headers, `ETag` caching, structured errors) already applies underneath it.
 *
 * Same reasoning as `rest.template.ts` for the bare `@Connector()`: `'graphql'` is NOT a real core
 * connector slot `@zanix/server` registers against (see `command.ts`'s own
 * `SLOTS_REQUIRING_DATAMASTER` doc) — it's a plain, self-sufficient connector to an external
 * GraphQL endpoint, never `@Connector({ slot: 'graphql' })`. No `initialize`/`close` override
 * needed either, same reason as `rest.template.ts`.
 */

/** `connectors/<name>.connector.ts` */
export const graphqlConnectorTemplate = (pascalName: string): string =>
  `import { Connector, GraphQLClient } from '@zanix/server'

/**
 * GraphQL client for ${pascalName}.
 *
 * @class
 * @extends GraphQLClient
 */
@Connector()
export class ${pascalName}Connector extends GraphQLClient {
  constructor() {
    super({ baseUrl: 'https://api.example.com/graphql' })
  }

  public getExample(id: string) {
    return this.query<{ example: unknown }>(
      \`query ($id: ID!) { example(id: $id) { id } }\`,
      { variables: { id } },
    )
  }
}
`
