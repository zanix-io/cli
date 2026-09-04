# `zanix generate` — artifact generators

`zanix generate <artifact> <name> [root]` (alias: `zanix g`) adds a single
artifact to an **already-existing** Zanix project — the counterpart to
[`zanix new`](./new.md), which bootstraps a whole project from scratch. Every
generator:

- Only runs inside a project of the right type — `server`/`space-server` for
  every backend artifact below, `space`/`space-server` for
  `comet`/`page`/`layout`/`error`/`loading`/`not-found`/`graphql-schema` —
  erroring out otherwise
  (`The '<artifact>' generator must be run inside a 'server' or 'space-server' project.`,
  or the `'space'`/`'space-server'` equivalent). **`interactor` is the one
  exception**: it runs in `server`/`space-server`/`space` alike — see
  [below](#interactor) for why a plain `space` project genuinely needs it too,
  and for the different folder it lands in there.
- **Never overwrites an existing file.** If the target path already exists, that
  file is silently left untouched — safe to re-run. **`openapi`/`graphql-schema`
  are the two deliberate exceptions** — see [below](#openapi-spec) and
  [below](#graphql-schema-cache), they regenerate their output in full on every
  run.
- Accepts an optional trailing `root` argument to target a project other than
  the current working directory
  (`zanix generate handler users /path/to/project`).
- Accepts `--verify` (opt-in, off by default) — see [below](#--verify).
  `openapi`/`graphql-schema` do not: their output is plain text (JSON/SDL) with
  zero imports, so there is nothing for `--verify`'s `deno check` to check.

```bash
zanix generate <artifact> <name> [root]
```

This page covers every **backend** artifact (`server`/`space-server`
projects). For the 6 **frontend** artifacts
(`comet`/`page`/`layout`/`error`/`loading`/`not-found`, `space`/`space-server`
projects), see
[`generate-space.md`](./generate-space.md).

| Artifact             | Command                                  | Options                                                | Creates                                                                                                                            |
| -------------------- | ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Repository seeder    | `zanix generate seeder <name>`           | —                                                      | `repositories/<name>/seeders/{main,seeders.dev,seeders.prod}.ts`, plus `src/utils/seeders.ts` (once, shared)                       |
| Repository           | `zanix generate repository <name>`       | —                                                      | `repositories/<name>/{entity.provider,model.defs}.ts`                                                                              |
| Handler              | `zanix generate handler <name>`          | `-t, --type <type>` (default `rest`)                   | `handlers/<name>.{handler,resolver.handler,socket.handler,ssr.handler}.ts` (per `--type`) — see [below](#handler)                  |
| RTO (DTO) set        | `zanix generate rto <name>`              | `-f, --field <spec>` (repeatable)                      | `handlers/rtos/<name>.rto.ts` — see [below](#rto-dto-set)                                                                          |
| Connector shell      | `zanix generate connector <name>`        | `-s, --slot <slot>`                                    | `connectors/<name>.connector.ts` — see [below](#connector)                                                                         |
| Interactor shell     | `zanix generate interactor <name>`       | —                                                      | `interactors/<name>.interactor.ts` (`server`/`space-server`) or `<name>/<name>.interactor.ts` (`space`) — see [below](#interactor) |
| Job definition       | `zanix generate job <name>`              | `-c, --cron <expression>`                              | `jobs/<name>.defs.ts`                                                                                                              |
| DLQ processor        | `zanix generate dlqprocessor <name>`     | `-p, --process-type`, `-s, --schedule` (both required) | `dlq/<name>.defs.ts`, plus `repositories/dlq.defs.ts` (once, shared) — see [below](#dlq-processor)                                 |
| Queue subscriber     | `zanix generate subscriber <name>`       | `-q, --queue <route>`                                  | `subscribers/<name>.subscriber.handler.ts`                                                                                         |
| Middleware shell     | `zanix generate middleware <name>`       | `-k, --kind <kind>` (required)                         | `shared/middlewares/<name>.{guard,pipe,interceptor}.ts` (per `--kind`) — see [below](#middleware)                                  |
| Global middleware    | `zanix generate globalmiddleware <name>` | `-k, --kind <kind>` (required)                         | `shared/middlewares/<name>.{pipe,guard,interceptor}.defs.ts` (per `--kind`) — see [below](#global-middleware)                      |
| OpenAPI spec         | `zanix generate openapi`                 | `-a, --application <name>`, `--include-admin`          | `openapi.json` at the **project root** — see [below](#openapi-spec)                                                                |
| GraphQL schema cache | `zanix generate graphql-schema`          | —                                                      | `gql/<name>.schema.graphql` per opted-in client — see [below](#graphql-schema-cache)                                               |

Every artifact above generates relative to `src/server/` in the target
project (e.g. `handlers/<name>.handler.ts` really means
`src/server/handlers/<name>.handler.ts`) — **except `openapi`, which writes to
the project root** (`openapi.json`, not `src/server/openapi.json`),
**`middleware`/`globalmiddleware`, which write relative to `src/shared/`
instead** (`shared/middlewares/<name>.<kind>.ts` really means
`src/shared/middlewares/<name>.<kind>.ts`) — `src/shared/` is where
server-side cross-cutting scaffolding lives (reusable across handlers), as
opposed to `src/server/`'s per-domain logic; see [below](#middleware) and
[below](#global-middleware) for the two kinds this covers — **and
`graphql-schema`, a `space`/`space-server`-only artifact (unlike every other
artifact on this page) that writes relative to `src/space/gql/` instead**
(`gql/<name>.schema.graphql` really means `src/space/gql/<name>.schema.graphql`)
— see [below](#graphql-schema-cache). See
[`generate-space.md`](./generate-space.md) for the 6 seed-style frontend
artifacts that generate relative to `src/space/` too.

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

| `--type`         | File                         | Class              | Decorator        | Base class           |
| ---------------- | ---------------------------- | ------------------ | ---------------- | -------------------- |
| `rest` (default) | `<name>.handler.ts`          | `<Name>Controller` | `@Controller`    | `ZanixController`    |
| `graphql`        | `<name>.resolver.handler.ts` | `<Name>Resolver`   | `@Resolver`      | `ZanixResolver`      |
| `socket`         | `<name>.socket.handler.ts`   | `<Name>Socket`     | `@Socket`        | `ZanixWebSocket`     |
| `ssr`            | `<name>.ssr.handler.ts`      | `<Name>Controller` | `@SsrController` | `ZanixSsrController` |

Every one of these 4 files ends in `.handler.ts` — the exact suffix
`@zanix/server`'s own real `ZANIX_SERVER_MODULES` uses for auto-discovery
(`@zanix/core`'s `defineLocalMetadata`, run by both `Zanix.start()` and
`Zanix.compose()`). `graphql`/`socket`/`ssr` each still get their own
distinctive prefix before `.handler.ts` (`resolver`/`socket`/`ssr`) so
generating more than one type for the same entity name never collides on the
same file.

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

Creates `handlers/products.resolver.handler.ts`, using `@Query` (the same family also
has `@Mutation`, not generated by default — add it by hand once you need one).
`ZanixResolver`/`Resolver`/`Query`/`Mutation`/`Request` live at `@zanix/server`'s
own `./graphql` subpath, not the root — declared as its own dependency
(`@zanix/server/graphql`), on top of the plain `@zanix/server` every handler
type declares:

```typescript
import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'
import type { HandlerContext } from '@zanix/server'

@Resolver({ prefix: 'products' })
export class ProductsResolver extends ZanixResolver {
  @Query({ output: 'Products' })
  public list(_payload: Record<string, never>, _ctx: HandlerContext) {
    return []
  }
}
```

Unlike REST/SSR (whose real dispatch invokes the handler method with a single
`ctx` argument), every `@Query`/`@Mutation` method is always invoked with
**two** arguments, `(payload, ctx)`, regardless of whether the query declares
an `input` — the generated stub declares both, even though this example has no
`input` (so `payload` is always an empty object at runtime, hence
`Record<string, never>`).

### Socket

```bash
zanix generate handler chat --type socket
```

Creates `handlers/chat.socket.handler.ts`. Unlike REST/GraphQL, a socket handler has no
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

Creates `handlers/products.ssr.handler.ts`. Shares the exact same
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

| `type`        | Decorator     | TS type                       |
| ------------- | ------------- | ----------------------------- |
| `string`      | `IsString`    | `string`                      |
| `number`      | `IsNumber`    | `number`                      |
| `boolean`     | `IsBoolean`   | `boolean`                     |
| `email`       | `IsEmail`     | `string`                      |
| `date`        | `IsDate`      | `Date`                        |
| `uuid`        | `IsUUID`      | `string`                      |
| `objectId`    | `IsObjectID`† | `string`                      |
| `permission`  | `IsString`*   | `string`                      |
| `enum(A,B,C)` | `IsEnum`      | `'A' \| 'B' \| 'C'` (a union) |

\* `permission` renders as a plain `IsString`, not a dedicated validator —
investigated and confirmed there is no real, enforced "permission format"
anywhere in the ecosystem to validate against: `@zanix/admin` uses real,
in-production hierarchical strings (`zanix:admin:triggers`) alongside equally
real flat strings (`'admin'`), and `@zanix/auth`'s own comparison logic
(`scopeValidation`) does exact-Set-membership + wildcard `'*'` matching, never
parsing or splitting a permission string at all. An earlier hand-templated
`IsPermission`/`PERMISSION_REGEX` (requiring exactly one `module:action` `:`)
was removed for exactly that reason — it rejected real production values.
`permission` stays a supported `--field` type (still a meaningful label for a
permission-shaped column) with no dedicated decorator to converge toward.

† `IsObjectID` is a real `@zanix/validator` decorator (same shape as `IsUUID`),
imported directly like `IsEmail`/`IsUUID` — **but only once `@zanix/utils`
publishes a version past `cli`'s currently pinned `^2.6.1`**. It was added to
`@zanix/utils`'s own source (targeting `2.7.0`) after `2.6.1` — the latest
version actually live on JSR as of this writing — so a project generated
today still gets the `import { IsObjectID } from '@zanix/validator'` line,
but it won't resolve until that publish lands (same "real in the source, not
yet published" situation as `@zanix/utils`'s `no-znx-console` auto-fix).

```bash
zanix generate rto users --field email:email
```

Generates `handlers/rtos/users.rto.ts` with **four** classes sharing one deduped
import block — a `Search` RTO (an optional `query: string`), a `Get` RTO (an
`id: string`, always present regardless of your `--field` list), the create RTO
(your fields, all required unless you marked them `?`), and an `Edit` RTO (`id`
plus every one of your fields forced optional):

```typescript
import { BaseRTO, IsEmail, IsObjectID, IsString } from '@zanix/validator'
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

Server/space-server projects only — same restriction every backend artifact on
this page has (see the top of this page).

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

> **Runtime precondition, not verified by `--verify`:** `'database'` is a
> reserved core slot that `@zanix/server` itself never registers — only some
> OTHER package's own module does, by calling `registerCoreConnectorSlot`
> (`@zanix/server`'s `connectors/core/all.ts`). Today, only `@zanix/datamaster`
> does (its Mongo connector). Decorating this generated class with
> `@Connector({ slot: 'database' })` throws a real runtime `InternalError`
> unless `@zanix/datamaster` (or some other package that registers
> `'database'`) is already a dependency of this project AND is actually
> imported somewhere in its module graph before this class loads — declaring
> the dependency alone isn't enough. This generator warns (via `logger.warn`,
> without failing) when `@zanix/datamaster` isn't declared in `deno.json` yet,
> but it cannot verify the import itself happened.

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

> **Same runtime precondition as `--slot database`, for `cache:redis` and
> `cache:local` specifically:** those two are reserved core slots that only
> `@zanix/datamaster` registers today (its Redis and QLRU cache providers,
> respectively) — the same "declared isn't enough, it must actually be
> imported" caveat applies, and this generator warns the same way when
> `@zanix/datamaster` isn't declared yet. `cache:custom` and `cache:memcached`
> are exempt — `@zanix/server` registers both itself, unconditionally, so
> those two always work with no extra dependency. Any OTHER `cache:<subtype>`
> you make up isn't a reserved slot at all, so it isn't subject to this
> precondition either — it's decorated as a plain custom connector.

`asyncmq`/`kvLocal`/`search` slots aren't covered by `--slot` — `asyncmq`
already has a real connector in `@zanix/asyncmq`; `kvLocal`/`search` weren't
verified with the same rigor yet.

## Interactor

```bash
zanix generate interactor products
```

In a `server`/`space-server` project, creates
`interactors/products.interactor.ts` — the bridge between a handler and the
data layer:

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

**Also runs in a plain `space` project** — a `@zanix/space` app that owns no
backend of its own but consumes a remote, typed Zanix API still needs a real
`ZanixInteractor` in front of its own thin `RestClient` wrapper, the same
shape `@zanix/console`'s own `TriggersInteractor`/`TemplatesInteractor` use in
production. A `space` project has no `src/server/` to put a shared
`interactors/` folder in, so it lands in its own per-domain folder instead —
`zanix generate interactor triggers` writes `src/triggers/triggers.interactor.ts`,
matching the domain-named-folder shape `@zanix/console`'s own real interactors
follow (`triggers/triggers.interactor.ts`, `templates/templates.interactor.ts`).
`@zanix/server` is added to `imports` on demand the same way as any other
project type — a plain `space` project doesn't declare it until the first
interactor (or another `server`-shaped generator) is generated into it. Not
seeded by `zanix new space`/`spacecraft` yet: unlike `interactors/` in a
backend project, this is a per-domain folder named after each interactor, so
there is no single fixed tree leaf for a Recipe entry to target — the same
"no typed leaf to target" gap `component` already documents for `space`.

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
import { registerJob } from '@zanix/asyncmq/jobs'

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
import { registerCronJob } from '@zanix/asyncmq/jobs'

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

Creates `subscribers/<name>.subscriber.handler.ts` — a queue consumer shell.
Ends in `.handler.ts` (not a bare `.subscriber.ts`) for the same auto-discovery
reason [`handler`](#handler) does — `@zanix/asyncmq`'s own `Subscriber`
decorator calls the decorated class a "Subscriber handler", and only a real
`ZANIX_SERVER_MODULES` suffix (`@zanix/server`) gets auto-imported by
`Zanix.startWorker()`. Omitting `--queue` derives the queue/topic route from
the kebab-cased name; passing it overrides that with an explicit route:

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

## Middleware

```bash
zanix generate middleware <name> --kind guard|pipe|interceptor
```

Creates `shared/middlewares/<name>.<kind>.ts` — a shell built directly on
`defineMiddlewareDecorator`, the one real primitive behind all three kinds in
`@zanix/server` (the `Guard`/`Pipe`/`Interceptor` sugar decorators are each just
a one-line wrapper around it). Lands in `src/shared/`, not `src/server/`:
this is server-side cross-cutting scaffolding (reusable across handlers), the
same convention [`globalmiddleware`](#global-middleware) independently
targets for its own DSL definitions — `src/shared/` doesn't exist at all in a
pure `space` project, so this is a server-side-only convention, not a
space/server-shared one despite the name. `--kind` is **required**: unlike
`handler`'s `--type` (which defaults to `rest`), `guard`/`pipe`/`interceptor`
are three
equally common concerns with no natural default to guess at.

| `--kind`      | File                    | Middleware signature                                                         |
| ------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `guard`       | `<name>.guard.ts`       | `(ctx: GuardContext) => GuardResponse \| Promise<GuardResponse>`             |
| `pipe`        | `<name>.pipe.ts`        | `(ctx: HandlerContext) => void \| Promise<void>`                             |
| `interceptor` | `<name>.interceptor.ts` | `(ctx: HandlerContext, response: Response) => Response \| Promise<Response>` |

### `--kind guard`

```bash
zanix generate middleware auth --kind guard
```

Runs before the handler (and before any pipes/interceptors), deciding whether
the request is allowed to proceed. Its context (`GuardContext`) additionally
exposes `interactors`/`providers`/`connectors` getters — a pipe/interceptor's
plain `HandlerContext` does not:

```typescript
import type { GuardContext, GuardResponse } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

export const AuthGuard = defineMiddlewareDecorator(
  'guard',
  (_ctx: GuardContext): GuardResponse => {
    // Decide whether to allow the request here, e.g.:
    // if (!_ctx.session) return { response: new Response('Unauthorized', { status: 401 }) }
    return {}
  },
)
```

### `--kind pipe`

```bash
zanix generate middleware validation --kind pipe
```

Runs before the handler, for validating, sanitizing, or transforming incoming
data. It never returns a `Response` directly — throw to short-circuit the
request instead:

```typescript
import type { HandlerContext } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

export const ValidationPipe = defineMiddlewareDecorator(
  'pipe',
  (_ctx: HandlerContext): void => {
    // Validate, sanitize, or transform incoming data here.
  },
)
```

### `--kind interceptor`

```bash
zanix generate middleware response-headers --kind interceptor
```

Runs after the handler has already produced a `Response`, for modifying,
wrapping, or observing it:

```typescript
import type { HandlerContext } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

export const ResponseHeadersInterceptor = defineMiddlewareDecorator(
  'interceptor',
  (_ctx: HandlerContext, response: Response): Response => {
    // Modify, wrap, or observe the outgoing Response here, e.g.:
    // response.headers.set('X-Custom-Header', 'value')
    return response
  },
)
```

Apply any of the three generated decorators directly on a handler method
(applies just to that handler) or on a whole class (applies to every method on
it), e.g. `@AuthGuard public async someHandler(ctx: HandlerContext) { ... }`.

`zanix new server`/`zanix new space-server` already seed `src/shared/middlewares`
with two real examples generated the same way as this command
(`example.pipe.ts`, `example.interceptor.ts`) — `middleware` is no longer in
the same not-yet-seeded position as `dlqprocessor`/`subscriber`, which still
have no seeding recipe. A plain `space`/`app` project has no `src/shared/`
folder at all (REST-flavored scaffolding only makes sense for a project that
actually boots the `rest` server type). `zanix generate middleware` works the
same way either way, on a freshly scaffolded project or any already-scaffolded
`server`/`space-server` one.

## Global middleware

```bash
zanix generate globalmiddleware <name> --kind pipe|guard|interceptor
```

A structurally different concern from [`middleware`](#middleware) above, not a
4th `--kind` bolted onto it: `middleware`'s three kinds are all the same
shape — a decorator (`defineMiddlewareDecorator`) applied **by hand** to one
handler method/class. `globalmiddleware` instead writes a DSL definition —
`registerGlobalPipe`/`registerGlobalGuard`/`registerGlobalInterceptor` in
`@zanix/server` — that's **auto-discovered** (never applied anywhere by hand)
and runs against every request across the server types listed in its own
`exports.server` (`['all']` by default). The same `.defs.ts` shape
[`job`](#job)/[`dlqprocessor`](#dlq-processor) already use for this reason —
its own dedicated command, not an option on a differently-shaped generator.

`--kind` is **required**, same reasoning as `middleware`'s own `--kind`:
`pipe`/`guard`/`interceptor` are three equally common concerns with no natural
default to guess at.

| `--kind`      | File                         | Global middleware signature                                                    |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `pipe`        | `<name>.pipe.defs.ts`        | `(ctx: GlobalMidContext) => void \| Promise<void>`                             |
| `guard`       | `<name>.guard.defs.ts`       | `(ctx: GuardContext) => GuardResponse \| Promise<GuardResponse>`               |
| `interceptor` | `<name>.interceptor.defs.ts` | `(ctx: GlobalMidContext, response: Response) => Response \| Promise<Response>` |

Writes into `shared/middlewares/` (`src/shared/middlewares/<name>.<kind>.defs.ts`
in the target project) — the SAME folder `zanix new server`'s own scaffold
already seeds with `middleware`'s per-handler examples, and the real, observed
convention for app-level middleware definitions. Every file ends in
`.defs.ts` — the real `@zanix/server` `ZANIX_SERVER_MODULES` suffix
`@zanix/core`'s `defineLocalMetadata` auto-scans for — with a distinctive
`pipe`/`guard`/`interceptor` prefix before it so generating more than one kind
for the same entity name never collides on the same file.

### `--kind pipe`

```bash
zanix generate globalmiddleware audit --kind pipe
```

Runs before the handler, across every request matching `exports.server`. It
never returns a `Response` directly — throw to short-circuit the request
instead:

```typescript
import type { MiddlewareGlobalPipe } from '@zanix/server'

import { registerGlobalPipe } from '@zanix/server'

const AuditPipe: MiddlewareGlobalPipe = function AuditPipe(ctx) {
  // Validate, sanitize, or transform incoming data here.
}

AuditPipe.exports = {
  server: ['all'],
}

registerGlobalPipe(AuditPipe)
```

### `--kind guard`

```bash
zanix generate globalmiddleware auth --kind guard
```

Runs before any pipe/interceptor and before the handler, across every request
matching `exports.server`. Its context (`GuardContext`) additionally exposes
`interactors`/`providers`/`connectors` getters — a global pipe/interceptor's
plain `GlobalMidContext` does not — and it can short-circuit the request by
returning a `response`:

```typescript
import type { GuardResponse, MiddlewareGlobalGuard } from '@zanix/server'

import { registerGlobalGuard } from '@zanix/server'

const AuthGuard: MiddlewareGlobalGuard = function AuthGuard(_ctx): GuardResponse {
  // if (!_ctx.locals.session) return { response: new Response('Unauthorized', { status: 401 }) }
  return {}
}

AuthGuard.exports = {
  server: ['all'],
}

registerGlobalGuard(AuthGuard)
```

### `--kind interceptor`

```bash
zanix generate globalmiddleware response-headers --kind interceptor
```

Runs after the handler has already produced a `Response`, across every request
matching `exports.server`, for modifying, wrapping, or observing it:

```typescript
import type { MiddlewareGlobalInterceptor } from '@zanix/server'

import { registerGlobalInterceptor } from '@zanix/server'

const ResponseHeadersInterceptor: MiddlewareGlobalInterceptor = function ResponseHeadersInterceptor(
  _ctx,
  response,
) {
  // response.headers.set('X-Custom-Header', 'value')
  return response
}

ResponseHeadersInterceptor.exports = {
  server: ['all'],
}

registerGlobalInterceptor(ResponseHeadersInterceptor)
```

Restrict any of the three to specific server types via `exports.server`, e.g.
`{ server: ['rest'] }` — defaults to `['all']`.

## OpenAPI spec

```bash
zanix generate openapi [--application main]
```

Unlike every other generator on this page, `openapi` takes no `<name>` — it
doesn't create a new artifact, it statically introspects every REST route
your project's own handlers already registered (via `@Controller`/
`@Get`/`@Post`/... and their `rto` option) and writes the result as
`openapi.json` at the **project root** (not `src/server/`).

**This command OVERWRITES `openapi.json` on every run.** It's a
machine-derived snapshot of your project's current route metadata, not a
hand-editable shell — there's nothing in it meant to be edited by hand
between runs, and re-running is how it stays accurate as you add/change
handlers.

`--application <name>` restricts the spec to routes registered under one
Application (see `docs/handlers.md`'s "Applications" section in
`@zanix/server`) — omit it to include every discovered route regardless of
which Application it belongs to.

`--include-admin` (off by default) additionally discovers `@zanix/admin`'s
built-in `'admin'`-Application routes (`/admin/service-token`, and whichever
of `/admin/triggers`/`/admin/templates` the target project's own deployment
enables), by forwarding `{ admin: true }` to the target project's own
`Zanix.compose()` call. **Deliberately opt-in**, matching `Zanix.compose`'s
(and `Zanix.start`'s) own `admin` option default: the admin surface is
anchored and not meant to be reachable by an arbitrary public caller, so it
stays out of a generated OpenAPI document unless you explicitly ask for it —
the same trust posture every other Zanix entry point already gives it.
Combine it with `--application admin` to produce a spec containing JUST the
admin routes, the same generic narrowing `--application` already does for any
other Application:

```bash
zanix generate openapi --include-admin --application admin
```

Given routes shaped like this:

```typescript
@Controller({ prefix: 'products' })
export class ProductsController extends ZanixController {
  @Get()
  public list(_ctx: HandlerContext) {/* ... */}

  @Post('', { Body: CreateProductBody })
  public create(_ctx: HandlerContext) {/* ... */}

  @Get(':id', { Params: GetProductParams })
  public get(_ctx: HandlerContext) {/* ... */}
}
```

`openapi.json` looks like this (real output of this generator's own
`planOpenapiSpec`, not hand-written):

```json
{
  "openapi": "3.0.3",
  "info": { "title": "Zanix API", "version": "1.0.0" },
  "paths": {
    "/products": {
      "get": {
        "operationId": "get_products",
        "tags": ["main"],
        "responses": { "200": { "description": "Successful response." } }
      },
      "post": {
        "operationId": "post_products",
        "tags": ["main"],
        "responses": { "200": { "description": "Successful response." } },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "price": { "type": "number" }
                },
                "required": ["name"]
              }
            }
          }
        }
      }
    },
    "/products/{id}": {
      "get": {
        "operationId": "get_products_id",
        "tags": ["main"],
        "responses": { "200": { "description": "Successful response." } },
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": {} }
        ]
      }
    }
  }
}
```

An RTO field only appears in `properties`/`parameters` when it's
`expose: true` (never validated on the real instance otherwise), and only
lands in `required` when it isn't `optional`. `:id`-style path segments
become OpenAPI's `{id}` style. An RTO field decorated with something this
generator doesn't recognize gets an honest `{}` schema — never a guessed
type (see the `id` field above: `IsObjectID` isn't in the small set this
generator maps to a concrete JSON Schema type yet).

**`@ValidateNested(NestedRTO)` renders a real nested `object` schema, not
`{}`.** Given:

```typescript
class AddressRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor city!: string
}

class CreateProductBody extends BaseRTO {
  @IsString({ expose: true })
  @Length({ min: 1, max: 100 }, { expose: true })
  accessor name!: string

  @ValidateNested(AddressRTO, { expose: true })
  accessor shippingAddress!: AddressRTO
}
```

`shippingAddress` renders its own nested `properties` (recursively, for a
nested RTO with its own `@ValidateNested` fields) instead of an empty schema:

```json
{
  "name": { "type": "string", "minLength": 1, "maxLength": 100 },
  "shippingAddress": {
    "type": "object",
    "properties": { "city": { "type": "string" } },
    "required": ["city"]
  }
}
```

A field validating an array of nested objects (`@ValidateNested(RTO, { each:
true })`) renders `{ "type": "array", "items": <the nested object schema> }`
instead. **Every decorator stacked on the same field contributes to one
merged schema** — `name` above shows `IsString`'s own `type: 'string'`
merged with `Length`'s own `minLength`/`maxLength`, rather than only the
last-registered decorator winning. Both `ValidateNested`'s own resolution and
stacked-decorator merging need a `@zanix/utils` version whose `classMetadata`
tags every decorator (including `ValidateNested`, and reports a `decorators`
array when two or more stack on one field) — an older `@zanix/utils` that
predates this degrades gracefully to the same honest `{}` every other
unrecognized decorator already gets, not a crash.

**Real-code execution, scoped to your own project only.** Unlike every other
generator (which only write files), `openapi` actually runs your project's
own code — it spawns a real `deno run` subprocess rooted at the target
project to call `Zanix.compose()` and read back the resulting route
metadata (native ECMAScript decorator metadata can't cross a process
boundary any other way). This only ever runs against the project you point
it at (`root` defaults to the current working directory) — the same trust
boundary running `deno task`/`deno run` inside your own project already
implies, never a remote or arbitrary path.

**Requires a `@zanix/core`/`@zanix/server` version with route-introspection
support.** `cli`'s own `^2.0.0`/`^3.0.0` floors already resolve to real,
published versions carrying it (`@zanix/core@2.0.0`'s `Zanix.compose`,
`@zanix/server@3.3.0`'s `ProgramModule.routes`), so a freshly scaffolded
`server`/`space-server` project works out of the box. An older,
already-scaffolded project pinned below either floor instead fails with a
clear, actionable error (`... doesn't support Zanix.compose() ... — upgrade
@zanix/core`, or the `@zanix/utils`/`@zanix/server` equivalent for the same
class of gap) rather than a raw stack trace.

**`--include-admin` additionally requires a `@zanix/core` version with
`Zanix.compose`'s own `{ admin: true }` option** — also already published, as
of `@zanix/core@2.0.0`. Passing `--include-admin` against an older,
already-scaffolded project's `@zanix/core` fails the same way, with its own
clear, actionable error (`... doesn't support Zanix.compose()'s { admin: true
} option ... — upgrade @zanix/core`) rather than silently producing a spec
with no admin routes in it.

## GraphQL schema cache

```bash
zanix generate graphql-schema
```

Unlike every other generator on this page, `graphql-schema` takes no `<name>`
and only runs inside a **`space`/`space-server`** project (every other
artifact on this page requires `server`/`space-server`) — it discovers every
`**/*.client.ts` export shaped like a real `GraphQLClient`
(`@zanix/server`), narrows to the ones opted into
`schemaApplication: { external: true }`, and for each one runs a REAL
introspection call against that client's own live `baseUrl`, writing the
result as plain SDL text to `gql/<name>.schema.graphql` (relative to
`src/space/`, not `src/server/`).

**One run covers every opted-in client in the project, not just one.** With
`countries.client.ts` and `payments.client.ts` both declaring
`{ external: true }`, a single `zanix generate graphql-schema` writes both
`gql/countries.schema.graphql` and `gql/payments.schema.graphql` — see
"Regenerates every target's cache file in full on every run" below for what
happens if one of several fails.

**This is Case B** of `zanix space build`/`zanix space dev`'s GraphQL check:
a client's `schemaApplication` can be a plain Application name (checked
against a schema this project compiles itself), the literal `'external'`
(syntax-only, no schema to check against — the client genuinely talks to a
third-party API this project has no way to introspect statically), or
`{ external: true }` — also external, but ALSO opting into having its real
schema fetched and cached by this generator, then validated for real by
Layer 2 of the GraphQL check, the exact same way a local schema already is.
The object form itself is the opt-in; there's no separate boolean flag to
also remember:

```typescript
// src/space/clients/countries.client.ts
import { GraphQLClient } from '@zanix/server'

class CountriesClient extends GraphQLClient {
  constructor() {
    super({
      baseUrl: 'https://countries.trevorblades.com/graphql',
      schemaApplication: { external: true },
    })
  }
}

export const countriesClient = new CountriesClient()
```

Running `zanix generate graphql-schema` against a project with the client
above writes `gql/countries.schema.graphql` — real SDL text, converted from
the endpoint's own live introspection response via `graphql-js`'s
`buildClientSchema()` + `printSchema()`:

```graphql
type Country {
  code: ID!
  name: String!
  # ...every other field the real endpoint's schema actually has
}

type Query {
  countries: [Country!]!
  country(code: ID!): Country
  # ...
}
```

Every written file starts with a `#`-comment header (real GraphQL SDL syntax,
fully ignored by `parse()`/`buildSchema()` — no effect on Layer 2's own
`validate()` call against this same file) warning against hand-editing: this
is a snapshot of what the real remote API answered with, so an edit doesn't
change what that API actually accepts, and gets silently overwritten the next
time this command runs anyway. Regenerate it instead of touching it by hand.

`zanix space build`/`zanix space dev` then read this file back (Layer 2,
`checkGraphqlSchemas`) to validate `countries.client.ts`'s own queries
against it — the same `validate()` call a locally compiled schema already
gets, just sourced from a cache instead of a live subprocess. **If the cache
file doesn't exist yet, that's a warning, never a build failure** — it means
this generator hasn't been run yet for that client, and the check suggests
running it; a query is only ever reported as broken once a real cache
exists to check it against.

**Regenerates every target's cache file in full on every run**, the same
"machine-derived snapshot, not a hand-editable shell" exception `openapi`
already documents — a live, external API's schema can change (a field
added, another deprecated) independently of anything in your own project,
and re-running is how the cache catches up.

**A client with no `schemaApplication` at all, a plain Application name, or
the bare `'external'` string is never a target for this generator** — only
`{ external: true }` opts in. Most projects with an external GraphQL client
never need this generator at all; plain `'external'` already covers
syntax-only checking with zero setup.

**Requires a resolved `@zanix/server@^4.1.0`** for `GraphQLClient.introspect()`
and the `schemaApplication: { external: true }` object form to actually exist
— both new in that version, real and published on JSR (verified directly
against `https://jsr.io/@zanix/server/meta.json` and the package's own
published source). "Resolved" here means `zanix` itself, not your target
project's own declared `@zanix/server` version — every `**/*.client.ts` file
this generator (and Layer 2) discovers is imported IN-PROCESS, so its own
`import { GraphQLClient } from '@zanix/server'` resolves against `zanix`'s
OWN dependency graph, not your project's `deno.json`.

If `.introspect()` fails for a client (the endpoint has introspection
disabled, the network call fails, ...), that client's own cache file is
**never written** — no partial/corrupt SDL, ever — and a clear per-client
error is reported. Every OTHER target still gets its own real attempt; one
flaky/misconfigured API never hides another client's successful result. Once
every target has been attempted, the command fails (non-zero exit) if at
least one of them failed.

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

- [`generate-space.md`](./generate-space.md) — the 7 frontend artifacts
  (`comet`/`component`/`page`/`layout`/`error`/`loading`/`not-found`) for
  `@zanix/space` projects.
- [`new`](./new.md) — bootstraps a whole project, seeding it with example files
  generated by these same template functions.
- [`build`](./build.md) — compile/obfuscate the project once you've generated
  your artifacts.
- [`prepare`](./prepare.md) — Git hooks, CI workflow, and editor configuration.
