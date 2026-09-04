/**
 * Boilerplate for `zanix generate connector <name> --slot cache:<subtype>` (e.g. `cache:redis`,
 * `cache:memcached`, `cache:custom`, `cache:local`, or any other `cache:`-prefixed slot the
 * open core-connector registry accepts).
 *
 * Embedded as a string-template function for the same reason as `generic.template.ts` (`zanix
 * build` bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `ZanixCacheConnector` source
 * (`modules/infra/connectors/core/cache.ts`) — abstract, extends `ZanixConnector`, adds 9 abstract
 * methods (`getClient`/`set`/`get`/`has`/`delete`/`clear`/`size`/`keys`/`values`) on top of the
 * generic `initialize`/`close`/`isHealthy` lifecycle. Its constructor requires a `ttl` option;
 * left un-overridden here, so instantiation must pass one (the framework's DI options).
 *
 * `slot` is free text (only its `cache:` prefix is validated in `command.ts`; the subtype after it
 * is not), and it's interpolated at TWO different sites below with two different failure modes: the
 * `@Connector({ slot: ... })` string literal (the same breakout `escapeTsStringLiteral` guards
 * elsewhere) and the JSDoc comment line above it (a block-comment-terminator breakout instead,
 * guarded by `escapeJsDocCommentText`) — each site is routed through its own matching helper.
 * `pascalName` is NOT escaped at either site — it's already constrained to a safe identifier by
 * `assertValidIdentifier` in `command.ts`.
 */

import {
  escapeJsDocCommentText,
  escapeTsStringLiteral,
} from 'commands/generate/shared/escape-template-string.ts'

/** `connectors/<name>.connector.ts` */
export const cacheConnectorTemplate = (
  pascalName: string,
  slot: string,
): string =>
  `import { Connector, ZanixCacheConnector } from '@zanix/server'

/**
 * Cache connector for ${pascalName}, registered under the '${
    escapeJsDocCommentText(slot)
  }' core slot.
 *
 * @class
 * @extends ZanixCacheConnector
 */
@Connector({ slot: '${escapeTsStringLiteral(slot)}' })
export class ${pascalName}Connector extends ZanixCacheConnector {
  protected override initialize() {
    // Establish the connection to the cache backend here.
  }

  protected override close() {
    // Tear down the connection here.
  }

  public override isHealthy() {
    return true
  }

  public getClient<T = unknown>(): T {
    // Return the underlying cache client instance here.
    return undefined as T
  }

  public set(_key: unknown, _value: unknown) {
    // Insert or update a value in the cache here.
  }

  public get(_key: unknown) {
    // Retrieve a value from the cache here.
    return undefined
  }

  public has(_key: unknown): boolean {
    // Check whether the cache contains the given key here.
    return false
  }

  public delete(_key: unknown): boolean {
    // Delete an entry from the cache here.
    return false
  }

  public clear() {
    // Remove all entries from the cache here.
  }

  public size(): number {
    // Return the number of entries currently in the cache here.
    return 0
  }

  public keys(): unknown[] {
    // Return all keys currently stored in the cache here.
    return []
  }

  public values<O = unknown>(): O[] {
    // Return all values currently stored in the cache here.
    return []
  }
}
`
