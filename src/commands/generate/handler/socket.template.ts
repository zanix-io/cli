/**
 * Boilerplate for `zanix generate handler <name> --type socket`.
 *
 * Embedded as a string-template function for the same reason as `rest.template.ts` (`zanix build`
 * bundles this command's code into a single `.dist/app.mjs` output by default).
 *
 * Shape verified against `@zanix/server`'s own real `Socket`/`ZanixWebSocket` source
 * (`modules/infra/handlers/sockets/{decorators/base,base}.ts`) — unlike REST/GraphQL, a socket
 * handler has no method decorators; instead it overrides `ZanixWebSocket`'s `onopen`/`onmessage`/
 * `onclose`/`onerror` lifecycle methods (all have default no-op-ish implementations, so overriding
 * any of them is optional — this shell overrides just `onmessage`, the most common customization
 * point, matching the decorator's own doc-comment example).
 */

/** `handlers/<name>.socket.ts` */
export const socketHandlerTemplate = (pascalName: string, kebabName: string): string =>
  `import { Socket, ZanixWebSocket } from '@zanix/server'

/**
 * Socket handler for ${pascalName}.
 *
 * @class
 * @extends ZanixWebSocket
 */
@Socket('${kebabName}')
export class ${pascalName}Socket extends ZanixWebSocket {
  protected override onmessage(ev: MessageEvent) {
    // Handle the incoming message here, e.g.: return { echo: ev.data }
  }
}
`
