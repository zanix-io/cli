/**
 * Boilerplate for `zanix generate connector <name> --slot database`.
 *
 * Embedded as a string-template function for the same reason as `generic.template.ts` (`zanix
 * build` bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `ZanixDatabaseConnector` source
 * (`modules/infra/connectors/core/database.ts`) — abstract, extends `ZanixConnector`, adds one
 * abstract method (`getModel`) on top of the generic `initialize`/`close`/`isHealthy` lifecycle.
 *
 * **When to use this**: only to plug in your OWN database backend under the `'database'` core
 * slot. If you're using MongoDB, `@zanix/datamaster`'s `ZanixMongoConnector` already registers
 * this slot with a real, ready-to-use implementation — import and use that instead of generating
 * a new one.
 */

/** `connectors/<name>.connector.ts` */
export const databaseConnectorTemplate = (pascalName: string): string =>
  `import { Connector, ZanixDatabaseConnector } from '@zanix/server'

/**
 * Database connector for ${pascalName}, registered under the 'database' core slot.
 *
 * @class
 * @extends ZanixDatabaseConnector
 */
@Connector({ slot: 'database' })
export class ${pascalName}Connector extends ZanixDatabaseConnector {
  protected override initialize() {
    // Establish the connection to the database here.
  }

  protected override close() {
    // Tear down the connection here.
  }

  public override isHealthy() {
    return true
  }

  public getModel(model: unknown) {
    // Return the model instance for the given type here.
  }
}
`
