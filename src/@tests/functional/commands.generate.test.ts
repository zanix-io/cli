import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('generate seeder should write real file content into a server project', async () => {
  const project = `${temporaryFolder}/seeder-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'seeder', 'PaymentMethod', project],
    }).output()

    const seedersFolder = `${project}/src/server/repositories/payment-method/seeders`

    assert(fileExists(`${seedersFolder}/main.ts`))
    assert(fileExists(`${seedersFolder}/seeders.dev.ts`))
    assert(fileExists(`${seedersFolder}/seeders.prod.ts`))
    assert(fileExists(`${project}/src/utils/seeders.ts`))

    const main = await Deno.readTextFile(`${seedersFolder}/main.ts`)
    assert(main.includes("import { defineSeeders } from 'utils/seeders.ts'"))
    assertEquals(
      (await Deno.readTextFile(`${seedersFolder}/seeders.dev.ts`)).trim(),
      'export default []',
    )

    // Idempotency: running twice must not throw and must not overwrite the seeded content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'seeder', 'PaymentMethod', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(`${seedersFolder}/main.ts`), main)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate seeder should fail clearly outside a server/space-server project', async () => {
  const project = `${temporaryFolder}/library-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'seeder', 'payment', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate repository should write real file content into a server project', async () => {
  const project = `${temporaryFolder}/repository-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'repository', 'PaymentMethod', project],
    }).output()

    const repoFolder = `${project}/src/server/repositories/payment-method`

    assert(fileExists(`${repoFolder}/entity.provider.ts`))
    assert(fileExists(`${repoFolder}/model.defs.ts`))

    const provider = await Deno.readTextFile(`${repoFolder}/entity.provider.ts`)
    assert(provider.includes('export class PaymentMethodRepository'))
    assert(
      provider.includes(
        "import type { PaymentMethodAttrs } from './model.defs.ts'",
      ),
    )

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'repository', 'PaymentMethod', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(
      await Deno.readTextFile(`${repoFolder}/entity.provider.ts`),
      provider,
    )
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate repository should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-repository`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'repository', 'payment', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate handler should write real file content into a server project', async () => {
  const project = `${temporaryFolder}/handler-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'handler', 'UserSettings', project],
    }).output()

    const handlerPath = `${project}/src/server/handlers/user-settings.handler.ts`

    assert(fileExists(handlerPath))

    const content = await Deno.readTextFile(handlerPath)
    assert(content.includes('export class UserSettingsController'))
    assert(content.includes("@Controller({ prefix: 'user-settings' })"))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'handler', 'UserSettings', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(handlerPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate handler should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-handler`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'handler', 'user', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate handler --type graphql writes a resolver into a server project', async () => {
  const project = `${temporaryFolder}/handler-graphql-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'handler',
        'Products',
        '--type',
        'graphql',
        project,
      ],
    }).output()

    const content = await Deno.readTextFile(
      `${project}/src/server/handlers/products.resolver.handler.ts`,
    )
    assert(content.includes('export class ProductsResolver'))
    assert(content.includes("@Resolver({ prefix: 'products' })"))
    // `ZanixResolver`/`Resolver`/`Query` live at `@zanix/server`'s own `./graphql` subpath, not the
    // root — see `graphql.template.ts`'s own header doc.
    assert(
      content.includes(
        "import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'",
      ),
    )

    const config = JSON.parse(await Deno.readTextFile(`${project}/deno.json`))
    assert('@zanix/server/graphql' in config.imports)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate handler should fail clearly for an unsupported --type', async () => {
  const project = `${temporaryFolder}/handler-bad-type-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'handler', 'products', '--type', 'grpc', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server/handlers/products.grpc.ts`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate rto writes real, correctly-typed content in a server project', async () => {
  const project = `${temporaryFolder}/rto-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'rto',
        'PaymentMethod',
        '--field',
        'amount:number',
        '--field',
        'currencyId:objectId',
        '--field',
        'tags:string[]?',
        '--field',
        'status:enum(ACTIVE,INACTIVE)',
        project,
      ],
    }).output()

    const rtoPath = `${project}/src/server/handlers/rtos/payment-method.rto.ts`
    const validationsFolder = `${project}/src/server/handlers/rtos/validations`

    assert(fileExists(rtoPath))
    // `objectId` renders a real `@zanix/validator` import now — no local IsObjectID.ts/constants.ts.
    assert(!fileExists(`${validationsFolder}/IsObjectID.ts`))
    // No field used `permission` — IsPermission.ts must not be generated.
    assert(!fileExists(`${validationsFolder}/IsPermission.ts`))
    assert(!fileExists(`${project}/src/utils/constants.ts`))

    const content = await Deno.readTextFile(rtoPath)
    assert(
      content.includes(
        'export class SearchPaymentMethodRTO extends SearchPaginationRTO',
      ),
    )
    assert(content.includes('export class GetPaymentMethodRTO extends BaseRTO'))
    assert(content.includes('export class PaymentMethodRTO extends BaseRTO'))
    assert(content.includes('export class EditPaymentMethodRTO extends BaseRTO'))
    // `IsNumber` never takes `expose` (a real `@zanix/validator` type constraint) — see
    // `templates/rto.ts`'s own `FIELD_TYPE_INFO` comment.
    assert(content.includes('@IsNumber()\n  accessor amount!: number'))
    assert(content.includes('accessor tags: (string)[] | undefined'))
    assert(content.includes("@IsEnum(['ACTIVE', 'INACTIVE']"))
    assert(content.includes("from '@zanix/validator'") && content.includes('IsObjectID'))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'rto',
        'PaymentMethod',
        '--field',
        'amount:number',
        project,
      ],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(rtoPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test(
  'generate rto renders a permission field as a plain IsString, no local validator',
  async () => {
    // No dedicated `IsPermission` decorator/validator exists anywhere in the ecosystem — a real,
    // hand-templated `module:action` regex was investigated and removed for rejecting real
    // production permission strings (e.g. `@zanix/admin`'s `zanix:admin:triggers`) — see
    // `rto/renderer.ts`'s own doc. `permission` now renders identically to `string`.
    const project = `${temporaryFolder}/rto-permission-project`
    try {
      await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
        .output()
      await new Deno.Command('deno', {
        args: [
          'run',
          'generate',
          'rto',
          'Role',
          '--field',
          'grantedBy:permission',
          project,
        ],
      }).output()

      const validationsFolder = `${project}/src/server/handlers/rtos/validations`
      assert(!fileExists(`${validationsFolder}/IsPermission.ts`))
      assert(!fileExists(`${project}/src/utils/constants.ts`))

      const content = await Deno.readTextFile(
        `${project}/src/server/handlers/rtos/role.rto.ts`,
      )
      assert(content.includes('@IsString({ expose: true })\n  accessor grantedBy!: string'))
      assert(!content.includes('IsPermission'))
    } finally {
      await Deno.remove(project, { recursive: true })
    }
  },
)

Deno.test('generate rto should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-rto`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'rto',
        'payment',
        '--field',
        'name:string',
        project,
      ],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate rto should fail clearly when no --field is given', async () => {
  const project = `${temporaryFolder}/rto-no-fields-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'rto', 'payment', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server/handlers/rtos/payment.rto.ts`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate connector should write real file content into a server project', async () => {
  const project = `${temporaryFolder}/connector-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'connector', 'PaymentGateway', project],
    }).output()

    const connectorPath = `${project}/src/server/connectors/payment-gateway.connector.ts`
    assert(fileExists(connectorPath))

    const content = await Deno.readTextFile(connectorPath)
    assert(content.includes('export class PaymentGatewayConnector'))
    assert(content.includes('@Connector()'))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'connector', 'PaymentGateway', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(connectorPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate connector --slot database writes a database connector', async () => {
  const project = `${temporaryFolder}/connector-database-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'connector',
        'MainDb',
        '--slot',
        'database',
        project,
      ],
    }).output()

    const content = await Deno.readTextFile(
      `${project}/src/server/connectors/main-db.connector.ts`,
    )
    assert(content.includes('export class MainDbConnector'))
    assert(content.includes("@Connector({ slot: 'database' })"))
    assert(content.includes('extends ZanixDatabaseConnector'))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate connector --slot cache:redis writes a cache connector', async () => {
  const project = `${temporaryFolder}/connector-cache-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'connector',
        'RedisCache',
        '--slot',
        'cache:redis',
        project,
      ],
    }).output()

    const content = await Deno.readTextFile(
      `${project}/src/server/connectors/redis-cache.connector.ts`,
    )
    assert(content.includes('export class RedisCacheConnector'))
    assert(content.includes("@Connector({ slot: 'cache:redis' })"))
    assert(content.includes('extends ZanixCacheConnector'))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate connector should fail clearly for an unsupported --slot', async () => {
  const project = `${temporaryFolder}/connector-bad-slot-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'connector',
        'payment',
        '--slot',
        'asyncmq',
        project,
      ],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server/connectors/payment.connector.ts`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate connector should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-connector`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'connector', 'payment', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate interactor should write real file content into a server project', async () => {
  const project = `${temporaryFolder}/interactor-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'interactor', 'PaymentMethod', project],
    }).output()

    const interactorPath = `${project}/src/server/interactors/payment-method.interactor.ts`
    assert(fileExists(interactorPath))

    const content = await Deno.readTextFile(interactorPath)
    assert(content.includes('export class PaymentMethodService'))
    assert(content.includes('@Interactor()'))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'interactor', 'PaymentMethod', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(interactorPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate interactor should fail clearly outside server/space-server/space', async () => {
  const project = `${temporaryFolder}/library-project-interactor`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'interactor', 'payment', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate interactor should write a per-domain folder into a space project', async () => {
  const project = `${temporaryFolder}/interactor-space-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'space', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'interactor', 'Triggers', project],
    }).output()

    const interactorPath = `${project}/src/triggers/triggers.interactor.ts`
    assert(fileExists(interactorPath))

    const content = await Deno.readTextFile(interactorPath)
    assert(content.includes('export class TriggersService'))
    assert(content.includes('@Interactor()'))

    const config = JSON.parse(await Deno.readTextFile(`${project}/deno.json`))
    assert(config.imports['@zanix/server'])
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate job without --cron writes a queue-consumed registerJob', async () => {
  const project = `${temporaryFolder}/job-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'job', 'PaymentSync', project],
    }).output()

    const jobPath = `${project}/src/server/jobs/payment-sync.defs.ts`
    assert(fileExists(jobPath))

    const content = await Deno.readTextFile(jobPath)
    assert(content.includes("import { registerJob } from '@zanix/asyncmq/jobs'"))
    assert(content.includes("name: 'payment-sync'"))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'job', 'PaymentSync', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(jobPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate job with --cron writes a schedule-driven registerCronJob', async () => {
  const project = `${temporaryFolder}/job-cron-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'job',
        'PaymentSync',
        '--cron',
        '0 */1 * * * *',
        project,
      ],
    }).output()

    const content = await Deno.readTextFile(
      `${project}/src/server/jobs/payment-sync.defs.ts`,
    )
    assert(content.includes("import { registerCronJob } from '@zanix/asyncmq/jobs'"))
    assert(content.includes("schedule: '0 */1 * * * *'"))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate job should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-job`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'job', 'payment-sync', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate dlqprocessor writes the processor + the shared DLQ model file', async () => {
  const project = `${temporaryFolder}/dlqprocessor-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'dlqprocessor',
        'PaymentRetry',
        '--process-type',
        'payment.process',
        '--schedule',
        '0,30 * * * * *',
        project,
      ],
    }).output()

    const processorPath = `${project}/src/server/dlq/payment-retry.defs.ts`
    const modelPath = `${project}/src/server/repositories/dlq.defs.ts`
    assert(fileExists(processorPath))
    assert(fileExists(modelPath))

    const processor = await Deno.readTextFile(processorPath)
    assert(
      processor.includes(
        "import { registerDLQProcessor } from '@zanix/asyncmq/dlq'",
      ),
    )
    assert(processor.includes("registerDLQProcessor('payment.process'"))

    const model = await Deno.readTextFile(modelPath)
    assert(
      model.includes("import { registerDLQModel } from '@zanix/datamaster'"),
    )
    assert(model.includes('registerDLQModel()'))

    // Idempotency: a second processor must not touch the already-written shared model file.
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'dlqprocessor',
        'InvoiceRetry',
        '--process-type',
        'invoice.process',
        '--schedule',
        '0 0 * * * *',
        project,
      ],
    }).output()
    assertEquals(await Deno.readTextFile(modelPath), model)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate dlqprocessor should fail clearly when --process-type is missing', async () => {
  const project = `${temporaryFolder}/dlqprocessor-missing-type`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'dlqprocessor',
        'payment-retry',
        '--schedule',
        '0,30 * * * * *',
        project,
      ],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server/dlq`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate dlqprocessor should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-dlqprocessor`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'dlqprocessor',
        'payment-retry',
        '--process-type',
        'payment.process',
        '--schedule',
        '0,30 * * * * *',
        project,
      ],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate subscriber should write real file content into a server project', async () => {
  const project = `${temporaryFolder}/subscriber-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'subscriber', 'InventoryUpdates', project],
    }).output()

    const subscriberPath =
      `${project}/src/server/subscribers/inventory-updates.subscriber.handler.ts`
    assert(fileExists(subscriberPath))

    const content = await Deno.readTextFile(subscriberPath)
    assert(content.includes('export class InventoryUpdatesSubscriber'))
    assert(content.includes("@Subscriber('inventory-updates')"))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'subscriber', 'InventoryUpdates', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(subscriberPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate subscriber with --queue uses the given queue route', async () => {
  const project = `${temporaryFolder}/subscriber-queue-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'subscriber',
        'Orders',
        '--queue',
        'custom-orders-queue',
        project,
      ],
    }).output()

    const content = await Deno.readTextFile(
      `${project}/src/server/subscribers/orders.subscriber.handler.ts`,
    )
    assert(content.includes("@Subscriber('custom-orders-queue')"))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate subscriber should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-subscriber`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'subscriber', 'orders', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate middleware --kind guard writes a guard file into a project', async () => {
  const project = `${temporaryFolder}/middleware-guard-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'middleware', 'Auth', '--kind', 'guard', project],
    }).output()

    const middlewarePath = `${project}/src/shared/middlewares/auth.guard.ts`
    assert(fileExists(middlewarePath))

    const content = await Deno.readTextFile(middlewarePath)
    assert(content.includes('export const AuthGuard'))
    assert(content.includes("defineMiddlewareDecorator(\n  'guard',"))

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'middleware', 'Auth', '--kind', 'guard', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(middlewarePath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate middleware --kind pipe writes a pipe file into a server project', async () => {
  const project = `${temporaryFolder}/middleware-pipe-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()
    await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'middleware',
        'Validation',
        '--kind',
        'pipe',
        project,
      ],
    }).output()

    const content = await Deno.readTextFile(
      `${project}/src/shared/middlewares/validation.pipe.ts`,
    )
    assert(content.includes('export const ValidationPipe'))
    assert(content.includes("defineMiddlewareDecorator(\n  'pipe',"))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test(
  'generate middleware --kind interceptor writes an interceptor file into a server project',
  async () => {
    const project = `${temporaryFolder}/middleware-interceptor-project`
    try {
      await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
        .output()
      await new Deno.Command('deno', {
        args: [
          'run',
          'generate',
          'middleware',
          'ResponseHeaders',
          '--kind',
          'interceptor',
          project,
        ],
      }).output()

      const content = await Deno.readTextFile(
        `${project}/src/shared/middlewares/response-headers.interceptor.ts`,
      )
      assert(content.includes('export const ResponseHeadersInterceptor'))
      assert(content.includes("defineMiddlewareDecorator(\n  'interceptor',"))
    } finally {
      await Deno.remove(project, { recursive: true })
    }
  },
)

Deno.test('generate middleware should fail clearly when --kind is missing', async () => {
  const project = `${temporaryFolder}/middleware-missing-kind`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'middleware', 'auth', project],
    }).output()

    assertEquals(code, 1)
    // `src/shared/middlewares` itself already exists — `zanix new server` seeds it with its own
    // `example.pipe.ts`/`example.interceptor.ts` (`MIDDLEWARES_RECIPE`) regardless of this failure —
    // so this checks for the absence of the specific file this run would have written, not the
    // shared folder itself.
    assert(!fileExists(`${project}/src/shared/middlewares/auth.guard.ts`))
    assert(!fileExists(`${project}/src/shared/middlewares/auth.pipe.ts`))
    assert(!fileExists(`${project}/src/shared/middlewares/auth.interceptor.ts`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate middleware should fail clearly for an unsupported --kind', async () => {
  const project = `${temporaryFolder}/middleware-bad-kind-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: [
        'run',
        'generate',
        'middleware',
        'auth',
        '--kind',
        'transformer',
        project,
      ],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/shared/middlewares/auth.transformer.ts`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate middleware should fail clearly outside a server project', async () => {
  const project = `${temporaryFolder}/library-project-middleware`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'library', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'middleware', 'auth', '--kind', 'guard', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/server`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

// No other frontend artifact (`comet`/`page`/`layout`/`error`/`loading`/`not-found`) has a
// functional (real CLI subprocess) counterpart yet — only their unit tests exist. That gap
// predates this generator and is out of scope here; `component` gets one anyway, since every new
// generator earns a functional test regardless of what its siblings currently have.
Deno.test('generate component should write real file content into a space project', async () => {
  const project = `${temporaryFolder}/component-project`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'space', project] })
      .output()
    await new Deno.Command('deno', {
      args: ['run', 'generate', 'component', 'ProductCard', project],
    }).output()

    const componentPath = `${project}/src/space/components/product-card.tsx`
    assert(fileExists(componentPath))

    const content = await Deno.readTextFile(componentPath)
    assertEquals(
      content,
      `export default function ProductCard() {
  return <div>ProductCard</div>
}
`,
    )

    // Idempotency: running twice must not throw and must not overwrite the generated content.
    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'component', 'ProductCard', project],
    }).output()
    assertEquals(code, 0)
    assertEquals(await Deno.readTextFile(componentPath), content)
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})

Deno.test('generate component should fail clearly outside a space project', async () => {
  const project = `${temporaryFolder}/server-project-component`
  try {
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] })
      .output()

    const { code } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'component', 'product-card', project],
    }).output()

    assertEquals(code, 1)
    assert(!fileExists(`${project}/src/space`))
  } finally {
    await Deno.remove(project, { recursive: true })
  }
})
