/**
 * Boilerplate for `zanix generate subscriber <name> [--queue <route>]`.
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * Shape verified against `@zanix/asyncmq`'s own real `Subscriber`/`ZanixSubscriber` source
 * (`modules/subscribers/{decorators/base,base}.ts`) and its own test fixtures
 * (`src/@tests/functional/__setup__.ts`) — no external production repo was sampled for this one
 * (unlike `connector`/`interactor`, which came from `@zanix/server`'s own retired
 * `src/templates/`), since no such repo was available to check. `onmessage` is `protected
 * abstract` on `ZanixSubscriber`, so every subclass must implement it.
 *
 * `queue` is free text (an unvalidated `--queue` flag, defaulting to `kebabName` when omitted), so
 * it's routed through `escapeTsStringLiteral` right where it's embedded in a string literal below
 * — see that helper's own doc for why this is required, not optional. `pascalName` is NOT escaped —
 * it's already constrained to a safe identifier by `assertValidIdentifier` in `command.ts`.
 */

import { escapeTsStringLiteral } from 'commands/generate/shared/escape-template-string.ts'

/** `subscribers/<name>.subscriber.handler.ts` */
export const subscriberTemplate = (pascalName: string, queue: string): string =>
  `import type { MessageInfo } from '@zanix/asyncmq'

import { Subscriber, ZanixSubscriber } from '@zanix/asyncmq'

@Subscriber('${escapeTsStringLiteral(queue)}')
export class ${pascalName}Subscriber extends ZanixSubscriber {
  protected override onmessage(message: unknown, info: MessageInfo) {
    // Handle the incoming message here.
  }
}
`
