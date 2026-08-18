/**
 * Boilerplate for `zanix generate connector <name>` (default — no `--slot`).
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * Content verbatim from `@zanix/server`'s own real `src/templates/src/server/connectors/
 * example.connector.ts` (this repo's previous single source of truth for this shape, retired in
 * favor of this generator — see `commands/new/lib/tree/projects/server.ts`), which was itself
 * populated from real `@zanix/server` API evidence: the `@Connector()` decorator + `ZanixConnector`
 * base class, `initialize()`/`close()`/`isHealthy()` lifecycle hooks.
 *
 * One of the templates `command.ts`'s `planConnector` selects between based on `--slot` (a plain
 * if/else chain, not a lookup table). This one (no `--slot`) is for a custom connector to an
 * external service that isn't a core framework slot at all — see `database.template.ts`/
 * `cache.template.ts` for those.
 */

/** `connectors/<name>.connector.ts` */
export const connectorTemplate = (pascalName: string): string =>
  `/**
 * A \`Connector\` wraps the lifecycle of a connection to an external service — a REST API, a
 * third-party SDK, anything not already covered by a companion package.
 *
 * **When to use this**: only for integrations no companion package already covers. If you're
 * connecting to MongoDB/Redis/a KV store, use \`@zanix/datamaster\`'s connectors instead; for
 * RabbitMQ/queues, use \`@zanix/asyncmq\`'s.
 *
 * **How it's used**: the framework calls \`initialize()\`/\`close()\`/\`isHealthy()\` automatically
 * during the app's startup/shutdown lifecycle (see \`@Connector\`'s \`startMode\`/\`lifetime\`/
 * \`autoInitialize\` options to control when/how that happens).
 */

import { Connector, ZanixConnector } from '@zanix/server'

@Connector()
export class ${pascalName}Connector extends ZanixConnector {
  protected override initialize() {
    // Establish the connection to the external service here.
  }

  protected override close() {
    // Tear down the connection here.
  }

  public override isHealthy() {
    return true
  }
}
`
