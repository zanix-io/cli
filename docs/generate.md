# `zanix generate` — artifact generators

`zanix generate <artifact> <name> [root]` (alias: `zanix g`) adds a single
artifact to an **already-existing** Zanix project — the counterpart to
[`zanix new`](./new.md), which bootstraps a whole project from scratch. Every
generator:

- Only runs inside a project of the right type — `server`/`space-server` for
  every backend artifact below, `space`/`space-server` for
  `comet`/`page`/`layout`/`error`/`loading`/`not-found` — erroring out otherwise
  (`The '<artifact>' generator must be run inside a 'server' or 'space-server' project.`,
  or the `'space'`/`'space-server'` equivalent).
- **Never overwrites an existing file.** If the target path already exists, that
  file is silently left untouched — safe to re-run.
- Accepts an optional trailing `root` argument to target a project other than
  the current working directory
  (`zanix generate handler users /path/to/project`).
- Accepts `--verify` (opt-in, off by default) — see [below](#--verify).

```bash
zanix generate <artifact> <name> [root]
```

This page covers every **backend** artifact (`server`/`space-server`
projects). For the 6 **frontend** artifacts
(`comet`/`page`/`layout`/`error`/`loading`/`not-found`, `space`/`space-server`
projects), see
[`generate-space.md`](./generate-space.md).

| Artifact          | Command                              | Options                                                | Creates                                                                                                       |
| ----------------- | ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Repository seeder | `zanix generate seeder <name>`       | —                                                      | `repositories/<name>/seeders/{main,seeders.dev,seeders.prod}.ts`, plus `src/utils/seeders.ts` (once, shared)  |
| Repository        | `zanix generate repository <name>`   | —                                                      | `repositories/<name>/{entity.provider,model.defs}.ts`                                                         |
| Handler           | `zanix generate handler <name>`      | `-t, --type <type>` (default `rest`)                   | `handlers/<name>.{handler,resolver,socket,ssr}.ts` (per `--type`) — see [below](#handler)                     |
| RTO (DTO) set     | `zanix generate rto <name>`          | `-f, --field <spec>` (repeatable)                      | `handlers/rtos/<name>.rto.ts`, plus `handlers/rtos/validations/IsObjectID.ts` (and `IsPermission.ts` if used) |
| Connector shell   | `zanix generate connector <name>`    | `-s, --slot <slot>`                                    | `connectors/<name>.connector.ts` — see [below](#connector)                                                    |
| Interactor shell  | `zanix generate interactor <name>`   | —                                                      | `interactors/<name>.interactor.ts`                                                                            |
| Job definition    | `zanix generate job <name>`          | `-c, --cron <expression>`                              | `jobs/<name>.defs.ts`                                                                                         |
| DLQ processor     | `zanix generate dlqprocessor <name>` | `-p, --process-type`, `-s, --schedule` (both required) | `dlq/<name>.defs.ts`, plus `repositories/dlq.defs.ts` (once, shared) — see [below](#dlq-processor)            |
| Queue subscriber  | `zanix generate subscriber <name>`   | `-q, --queue <route>`                                  | `subscribers/<name>.subscriber.ts`                                                                            |

Every artifact above generates relative to `src/server/` in the target project
(e.g. `handlers/<name>.handler.ts` really means
`src/server/handlers/<name>.handler.ts`) — see
[`generate-space.md`](./generate-space.md) for the 6 artifacts that generate
relative to `src/space/` instead.

These are the exact same template functions `zanix new server` calls to seed its
own example files — there is one source of truth for each artifact's shape, not
a separately hand-maintained copy (see [`new`](./new.md)).

## Seeder

```bash
zanix generate seeder products
```

Creates `repositories/products/seeders/main.ts`, `seeders.dev.ts`, and
`seeders.prod.ts`:

```typescript
// repositories/products/seeders/main.ts
import seedersProd from './seeders.prod.ts'
import seedersDev from './seeders.dev.ts'
import { defineSeeders } from 'utils/seeders.ts'

export default defineSeeders(seedersProd, seedersDev)
```

`seeders.dev.ts`/`seeders.prod.ts` each start as an empty `export default []`
array for you to fill in. The first time any `seeder` generator runs in a
project, it also writes the shared `src/utils/seeders.ts` helper
(`defineSeeders`) that every seeder's `main.ts` imports — it's written once and
never touched again on later runs.

## Repository

```bash
zanix generate repository products
```

Creates `repositories/products/entity.provider.ts` and
`repositories/products/model.defs.ts`:

```typescript
// repositories/products/entity.provider.ts
import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { ProductsAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'

@Provider()
export class ProductsRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<ProductsAttrs>('products')
  }

  public findAll() {
    return this.Model.find().exec()
  }
}
```

```typescript
// repositories/products/model.defs.ts
import { registerModel } from '@zanix/datamaster'

export type ProductsAttrs = {
  id: string
  createdAt: Date
  updatedAt: Date
}

registerModel<ProductsAttrs>({
  name: 'products',
  definition: {
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  options: { timestamps: true },
})
```

`model.defs.ts` intentionally has no `extensions.seeders` wired in — run
`zanix generate seeder
products` separately if you need one; not every
repository does.

## Handler

```bash
zanix generate handler <name> [--type rest|graphql|socket|ssr]
```

`--type` defaults to `rest`. Every type writes into `handlers/`, but with a
distinct file suffix so generating more than one type for the same entity name
never collides:

| `--type`         | File                 | Class              | Decorator        | Base class           |
| ---------------- | -------------------- | ------------------ | ---------------- | -------------------- |
| `rest` (default) | `<name>.handler.ts`  | `<Name>Controller` | `@Controller`    | `ZanixController`    |
| `graphql`        | `<name>.resolver.ts` | `<Name>Resolver`   | `@Resolver`      | `ZanixResolver`      |
| `socket`         | `<name>.socket.ts`   | `<Name>Socket`     | `@Socket`        | `ZanixWebSocket`     |
| `ssr`            | `<name>.ssr.ts`      | `<Name>Controller` | `@SsrController` | `ZanixSsrController` |

None of them reference an `Interactor` — every one of these decorators/base
classes works with none declared, and each generated file's header comment shows
exactly how to wire one in by hand once you've generated it separately
(`zanix generate interactor <name>`).

### REST (default)

```bash
zanix generate handler products
```

```typescript
import { Controller, Get, type HandlerContext, ZanixController } from '@zanix/server'

@Controller({ prefix: 'products' })
export class ProductsController extends ZanixController {
  @Get()
  public list(_ctx: HandlerContext) {
    return []
  }
}
```

### GraphQL

```bash
zanix generate handler products --type graphql
```

Creates `handlers/products.resolver.ts`, using `@Query` (the same family also
has `@Mutation`, not generated by default — add it by hand once you need one):

```typescript
import { type HandlerContext, Query, Resolver, ZanixResolver } from '@zanix/server'

@Resolver({ prefix: 'products' })
export class ProductsResolver extends ZanixResolver {
  @Query({ output: 'Products' })
  public list(_ctx: HandlerContext) {
    return []
  }
}
```

### Socket

```bash
zanix generate handler chat --type socket
```

Creates `handlers/chat.socket.ts`. Unlike REST/GraphQL, a socket handler has no
method decorators — it overrides `ZanixWebSocket`'s lifecycle methods instead
(`onopen`/`onmessage`/ `onclose`/`onerror`, all optional to override; the shell
overrides just `onmessage`):

```typescript
import { Socket, ZanixWebSocket } from '@zanix/server'

@Socket('chat')
export class ChatSocket extends ZanixWebSocket {
  protected override onmessage(ev: MessageEvent) {
    // Handle the incoming message here, e.g.: return { echo: ev.data }
  }
}
```

### SSR

```bash
zanix generate handler products --type ssr
```

Creates `handlers/products.ssr.ts`. Shares the exact same
`@Get`/`@Post`/`@Patch`/`@Put`/ `@Delete`/`@Request` method decorators REST
controllers use:

```typescript
import { Get, type HandlerContext, SsrController, ZanixSsrController } from '@zanix/server'

@SsrController({ prefix: 'products' })
export class ProductsController extends ZanixSsrController {
  @Get()
  public list(_ctx: HandlerContext) {
    // Render and return a response here, e.g.:
    //   import { renderToResponse } from '@zanix/space/react'  // or '@zanix/space/preact'
    //   return renderToResponse(<Page />)
    return []
  }
}
```

## RTO (DTO) set

```bash
zanix generate rto <name> --field <spec> [--field <spec> ...]
```

`--field` is repeatable and required at least once. Each spec is `name:type`,
with two optional modifiers:

- `?` — optional field (e.g. `age:number?`)
- `[]` — array field (e.g. `tags:string[]`), combinable with `?`
  (`tags:string[]?`)

| `type`        | Decorator       | TS type                       |
| ------------- | --------------- | ----------------------------- |
| `string`      | `IsString`      | `string`                      |
| `number`      | `IsNumber`      | `number`                      |
| `boolean`     | `IsBoolean`     | `boolean`                     |
| `email`       | `IsEmail`       | `string`                      |
| `date`        | `IsDate`        | `Date`                        |
| `uuid`        | `IsUUID`        | `string`                      |
| `objectId`    | `IsObjectID`*   | `string`                      |
| `permission`  | `IsPermission`* | `string`                      |
| `enum(A,B,C)` | `IsEnum`        | `'A' \| 'B' \| 'C'` (a union) |

\* `IsObjectID`/`IsPermission` are hand-invented, project-local validators (not
part of `@zanix/validator`) — generated once into `handlers/rtos/validations/`
the first time a field actually needs one, never overwritten afterward.

```bash
zanix generate rto users --field email:email
```

Generates `handlers/rtos/users.rto.ts` with **four** classes sharing one deduped
import block — a `Search` RTO (an optional `query: string`), a `Get` RTO (an
`id: string`, always present regardless of your `--field` list), the create RTO
(your fields, all required unless you marked them `?`), and an `Edit` RTO (`id`
plus every one of your fields forced optional):

```typescript
import { BaseRTO, IsEmail, IsString } from '@zanix/validator'
import { IsObjectID } from './validations/IsObjectID.ts'
import { SearchPaginationRTO } from '@zanix/datamaster'

export class SearchUsersRTO extends SearchPaginationRTO {
  @IsString({ expose: true, optional: true })
  accessor query: string | undefined
}

export class GetUsersRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor id!: string
}

export class UsersRTO extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string
}

export class EditUsersRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor id!: string
  @IsEmail({ expose: true, optional: true })
  accessor email: string | undefined
}
```

A field typed `enum(...)` renders as `@IsEnum(['A', 'B'], { expose: true })`
with a matching TS union type; `number`/`date` fields never take `expose` (both
decorators are typed without it, so passing it is a real compile error, not just
unnecessary — they render as bare `@IsNumber()`/ `@IsDate()` when no other
modifier applies).

## Connector

```bash
zanix generate connector <name> [--slot database|cache:<subtype>]
```

Without `--slot`, generates a generic lifecycle shell for wrapping a connection
to an external service (a REST API, a third-party SDK — anything not already
covered by a companion package):

```bash
zanix generate connector payments
```

Creates `connectors/payments.connector.ts`:

```typescript
import { Connector, ZanixConnector } from '@zanix/server'

@Connector()
export class PaymentsConnector extends ZanixConnector {
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
```

> If you're connecting to MongoDB, use `@zanix/datamaster`'s
> `ZanixMongoConnector` directly — it already registers the `'database'` slot
> with a real implementation; don't generate a new one for it. For
> RabbitMQ/queues, use `@zanix/asyncmq`'s connector the same way. `--slot` below
> is for plugging in your **own** implementation of a core slot, not for slots a
> companion package already implements.

### `--slot database`

For a **custom** database backend under the `'database'` core slot (extends
`ZanixDatabaseConnector`, adds the required `getModel` method):

```bash
zanix generate connector main-db --slot database
```

```typescript
import { Connector, ZanixDatabaseConnector } from '@zanix/server'

@Connector({ slot: 'database' })
export class MainDbConnector extends ZanixDatabaseConnector {
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
```

### `--slot cache:<subtype>`

For a **custom** cache backend under any `cache:`-prefixed core slot
(`cache:redis`, `cache:memcached`, `cache:custom`, `cache:local`, or any other
subtype the open connector registry accepts) — extends `ZanixCacheConnector`,
which adds 9 required methods (`getClient`/
`set`/`get`/`has`/`delete`/`clear`/`size`/`keys`/`values`):

```bash
zanix generate connector redis-cache --slot cache:redis
```

```typescript
import { Connector, ZanixCacheConnector } from '@zanix/server'

@Connector({ slot: 'cache:redis' })
export class RedisCacheConnector extends ZanixCacheConnector {
  // ...initialize/close/isHealthy, same as above, plus:

  public getClient<T = unknown>(): T {
    // Return the underlying cache client instance here.
    return undefined as T
  }

  public set(_key: unknown, _value: unknown) {
    // Insert or update a value in the cache here.
  }

  // ...get/has/delete/clear/size/keys/values, each a similar placeholder.
}
```

`asyncmq`/`kvLocal`/`search` slots aren't covered by `--slot` — `asyncmq`
already has a real connector in `@zanix/asyncmq`; `kvLocal`/`search` weren't
verified with the same rigor yet.

## Interactor

```bash
zanix generate interactor products
```

Creates `interactors/products.interactor.ts` — the bridge between a handler and
the data layer:

```typescript
import { Interactor, ZanixInteractor } from '@zanix/server'

@Interactor()
export class ProductsService extends ZanixInteractor {
  public list() {
    // Delegate to a provider/repository here, e.g.:
    // return this.providers.get(ProductsRepository).findAll()
    return []
  }
}
```

Reach any dependency through the generic getters —
`this.providers.get(SomeRepository)`, `this.connectors.get(SomeConnector)`,
`this.interactors.get(SomeInteractor)` — even when there's only one; there's no
single-slot `Connector`/`Provider` decorator option.

## Job

```bash
zanix generate job send-invoices
zanix generate job cleanup-temp-files --cron "0 0 * * * *"
```

Creates `jobs/<name>.defs.ts`. Omitting `--cron` generates an on-demand job
(`registerJob`); passing a 6-field cron expression generates a scheduled one
(`registerCronJob`, with `isActive: true`):

```typescript
// without --cron
import { registerJob } from '@zanix/asyncmq'

registerJob({
  name: 'send-invoices',
  processingQueue: 'soft',
  handler: function () {
    // Run the on-demand work here, e.g.:
    // const repository = this.providers.get(ExampleRepository)
  },
})
```

```typescript
// with --cron "0 0 * * * *"
import { registerCronJob } from '@zanix/asyncmq'

registerCronJob({
  name: 'cleanup-temp-files',
  isActive: true,
  processingQueue: 'soft',
  schedule: '0 0 * * * *',
  handler: function () {
    // Run the recurring work here, e.g.:
    // const repository = this.providers.get(ExampleRepository)
  },
})
```

## DLQ Processor

```bash
zanix generate dlqprocessor payment-retry --process-type payment.process --schedule "0,30 * * * * *"
```

Creates two files together — a project only ever needs the second one written
once, regardless of how many DLQ processors it ends up with:

- `dlq/<name>.defs.ts` — the reprocessing job itself, one `registerDLQProcessor`
  call:

  ```typescript
  import { registerDLQProcessor } from '@zanix/asyncmq/dlq'

  registerDLQProcessor('payment.process', {
    name: 'payment-retry',
    schedule: '0,30 * * * * *',
    isActive: true,
    processingQueue: 'soft',
    handler: async function (entry) {
      // Reprocess the failed entry here, e.g.:
      // const repository = this.providers.get(ExampleRepository)
      // await repository.retry(entry.payload)
    },
  })
  ```

- `repositories/dlq.defs.ts` — registers `@zanix/datamaster`'s DLQ model.
  Required exactly once per app (never once per processor) before
  `DLQProvider`/`registerDLQProcessor` can resolve it — written the first time
  `dlqprocessor` runs, left untouched by every run after that:

  ```typescript
  import { registerDLQModel } from '@zanix/datamaster'

  registerDLQModel()
  ```

Both `--process-type` (the `processType` a failed entry was originally pushed to
the DLQ under) and `--schedule` (a 6-field cron expression) are required —
there's no "on-demand" DLQ processor, unlike `job`.

## Subscriber

```bash
zanix generate subscriber inventory-updates
zanix generate subscriber payments --queue custom-queue-name
```

Creates `subscribers/<name>.subscriber.ts` — a queue consumer shell. Omitting
`--queue` derives the queue/topic route from the kebab-cased name; passing it
overrides that with an explicit route:

```typescript
import type { MessageInfo } from '@zanix/asyncmq'

import { Subscriber, ZanixSubscriber } from '@zanix/asyncmq'

@Subscriber('inventory-updates')
export class InventoryUpdatesSubscriber extends ZanixSubscriber {
  protected override onmessage(message: unknown, info: MessageInfo) {
    // Handle the incoming message here.
  }
}
```

`onmessage` is `protected abstract` on `ZanixSubscriber`, so every subscriber
must implement it. Wire in validation (`rto`) or an `Interactor` by hand once
you need them:
`@Subscriber({ queue: 'inventory-updates', rto: SomeRTO, Interactor: SomeInteractorClass })`.

## `--verify`

Opt-in on every generator, off by default — `zanix generate` stays 100% local
and instant unless you ask for this extra check:

```bash
zanix generate handler users --verify
```

After writing the file(s), runs `deno check` against the _whole_ project (not
just the new file — generating an artifact can only break the build if something
it imports is missing or has changed shape), against whatever `@zanix/*`
dependency versions are actually resolvable right now. A failure only ever warns
— it never changes the command's exit code — since the generated code is still
correct against `cli`'s own known API shape; it means an upstream Zanix package
changed in a way that broke it (or hasn't published a version yet), not that
generation itself failed. This is the same check this project's own CI runs on
a schedule across every project type/artifact combination — `--verify` just runs
it on-demand, scoped to your own project.

## See also

- [`generate-space.md`](./generate-space.md) — the 6 frontend artifacts
  (`comet`/`page`/`layout`/`error`/`loading`/`not-found`) for `@zanix/space`
  projects.
- [`new`](./new.md) — bootstraps a whole project, seeding it with example files
  generated by these same template functions.
- [`build`](./build.md) — compile/obfuscate the project once you've generated
  your artifacts.
- [`prepare`](./prepare.md) — Git hooks, CI workflow, and editor configuration.
