import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateConnectorAction, { planConnector } from 'commands/generate/connector/command.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(zanixProject: string): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({ zanix: { project: zanixProject } }),
  )
  return projectFolder
}

Deno.test(
  'generateConnectorAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateConnectorAction.call(new Commander(), {}, 'payment'),
        Error,
        "must be run inside a 'server' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateConnectorAction should write a connector file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateConnectorAction.call(new Commander(), {}, 'PaymentGateway')

    const connectorPath = `${projectFolder}/src/server/connectors/payment-gateway.connector.ts`
    const content = await Deno.readTextFile(connectorPath)

    assertEquals(
      content.includes('export class PaymentGatewayConnector'),
      true,
    )
    assertEquals(content.includes('@Connector()'), true)
    assertEquals(content.includes('extends ZanixConnector'), true)

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/server'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateConnectorAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateConnectorAction.call(new Commander(), {}, 'invoice')
    await generateConnectorAction.call(new Commander(), {}, 'invoice')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/connectors/invoice.connector.ts`,
    )
    assertEquals(content.includes('export class InvoiceConnector'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateConnectorAction should never overwrite an existing connector file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const connectorsFolder = `${projectFolder}/src/server/connectors`
  const connectorPath = `${connectorsFolder}/invoice.connector.ts`

  try {
    await Deno.mkdir(connectorsFolder, { recursive: true })
    await Deno.writeTextFile(connectorPath, '// customized by hand\n')

    await generateConnectorAction.call(new Commander(), {}, 'invoice')

    assertEquals(
      await Deno.readTextFile(connectorPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateConnectorAction --slot database writes a database connector', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateConnectorAction.call(
      new Commander(),
      { slot: 'database' },
      'MainDb',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/connectors/main-db.connector.ts`,
    )

    assertEquals(content.includes('export class MainDbConnector'), true)
    assertEquals(content.includes("@Connector({ slot: 'database' })"), true)
    assertEquals(content.includes('extends ZanixDatabaseConnector'), true)
    assertEquals(content.includes('getModel'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateConnectorAction --slot cache:redis writes a cache connector', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateConnectorAction.call(
      new Commander(),
      { slot: 'cache:redis' },
      'RedisCache',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/connectors/redis-cache.connector.ts`,
    )

    assertEquals(content.includes('export class RedisCacheConnector'), true)
    assertEquals(content.includes("@Connector({ slot: 'cache:redis' })"), true)
    assertEquals(content.includes('extends ZanixCacheConnector'), true)
    assertEquals(content.includes('getClient'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateConnectorAction should throw clearly for an unsupported --slot', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () =>
        generateConnectorAction.call(
          new Commander(),
          { slot: 'asyncmq' },
          'invoice',
        ),
      Error,
      "Unsupported connector slot 'asyncmq'",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planConnector without a slot returns a generic connector', () => {
  const { files } = planConnector(
    'example',
    'Example',
    undefined,
    '/root/src/server/connectors',
  )

  assertEquals(files.map((f) => f.NAME), ['example.connector.ts'])
})

Deno.test('planConnector throws for an unsupported slot', () => {
  assertThrows(
    () =>
      planConnector(
        'example',
        'Example',
        'asyncmq',
        '/root/src/server/connectors',
      ),
    Error,
    "Unsupported connector slot 'asyncmq'",
  )
})
