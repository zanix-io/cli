import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateConnectorAction, { planConnector } from 'commands/generate/connector/command.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { Commander } from 'cli'
import logger from '@zanix/utils/logger'

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

Deno.test(
  'generateConnectorAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateConnectorAction.call(new Commander(), {}, '../../../../victim'),
        Error,
        'path-traversal segment',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateConnectorAction.call(new Commander(), {}, '123entity'),
        Error,
        "isn't a valid TypeScript identifier",
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

Deno.test('generateConnectorAction --slot rest writes a REST connector', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateConnectorAction.call(
      new Commander(),
      { slot: 'rest' },
      'Payment',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/connectors/payment.connector.ts`,
    )

    assertEquals(content.includes('export class PaymentConnector'), true)
    assertEquals(content.includes('@Connector()'), true)
    assertEquals(content.includes('extends RestClient'), true)
    assertEquals(content.includes('this.http.get'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateConnectorAction --slot graphql writes a GraphQL connector', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateConnectorAction.call(
      new Commander(),
      { slot: 'graphql' },
      'Payment',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/connectors/payment.connector.ts`,
    )

    assertEquals(content.includes('export class PaymentConnector'), true)
    assertEquals(content.includes('@Connector()'), true)
    assertEquals(content.includes('extends GraphQLClient'), true)
    assertEquals(content.includes('this.query<'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateConnectorAction warns when --slot database is used without @zanix/datamaster declared',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), { slot: 'database' }, 'MainDb')

      assertEquals(warnStub.calls.length, 1)
      const [message] = warnStub.calls[0].args
      assert(String(message).includes('@zanix/datamaster'))
      assert(String(message).includes("'database'"))
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction does not warn for --slot database when @zanix/datamaster is already declared',
  async () => {
    const projectFolder = await makeProject('server')
    const configPath = `${projectFolder}/deno.jsonc`
    const config = JSON.parse(await Deno.readTextFile(configPath))
    config.imports = { '@zanix/datamaster': ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'] }
    await Deno.writeTextFile(configPath, JSON.stringify(config))

    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), { slot: 'database' }, 'MainDb')

      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction warns for --slot cache:local the same way as --slot database',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), { slot: 'cache:local' }, 'LocalCache')

      assertEquals(warnStub.calls.length, 1)
      const [message] = warnStub.calls[0].args
      assert(String(message).includes("'cache:local'"))
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction never warns for --slot cache:custom (auto-registered by @zanix/server)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), { slot: 'cache:custom' }, 'CustomCache')

      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction never warns for --slot cache:memcached (auto-registered by @zanix/server)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(
        new Commander(),
        { slot: 'cache:memcached' },
        'MemcachedCache',
      )

      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction never warns for --slot rest (not a core slot, no dependency required)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), { slot: 'rest' }, 'Payment')

      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction never warns for --slot graphql (not a core slot, no dependency required)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), { slot: 'graphql' }, 'Payment')

      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateConnectorAction never warns without --slot (generic connector, no core slot involved)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const warnStub = stub(logger, 'warn')

    try {
      await generateConnectorAction.call(new Commander(), {}, 'PaymentGateway')

      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

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

Deno.test(
  "generateConnectorAction escapes a single quote in --slot so it can't break out of the " +
    '@Connector({ slot: ... }) string literal',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateConnectorAction.call(
        new Commander(),
        { slot: "cache:redis'; console.log('pwned'); //" },
        'RedisCache',
      )

      const content = await Deno.readTextFile(
        `${projectFolder}/src/server/connectors/redis-cache.connector.ts`,
      )

      assertEquals(
        content.includes(
          "@Connector({ slot: 'cache:redis\\'; console.log(\\'pwned\\'); //' })",
        ),
        true,
      )
      assertEquals(
        content.includes("@Connector({ slot: 'cache:redis'; console.log("),
        false,
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  "generateConnectorAction neutralizes a '*/' in --slot so it can't prematurely close the " +
    'JSDoc comment above @Connector(...)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateConnectorAction.call(
        new Commander(),
        { slot: "cache:redis*/console.log('pwned')/*" },
        'RedisCache',
      )

      const content = await Deno.readTextFile(
        `${projectFolder}/src/server/connectors/redis-cache.connector.ts`,
      )

      // The comment stays closed exactly once, right before `@Connector(...)` — a raw `*/` inside
      // the interpolated value would have closed it early instead.
      const commentStart = content.indexOf('/**')
      const commentEnd = content.indexOf('*/')
      const connectorLine = content.indexOf('@Connector(')
      assertEquals(commentStart >= 0 && commentEnd > commentStart, true)
      assertEquals(commentEnd < connectorLine, true)
      assertEquals(
        content.slice(commentStart, commentEnd).includes('*/'),
        false,
      )

      // The value's own `*/` survived, just broken up so it can't terminate the comment.
      assertEquals(
        content.includes("registered under the 'cache:redis* /console.log"),
        true,
      )
      // The string literal (a different failure mode) still gets its own, separate escaping.
      assertEquals(
        content.includes(
          "@Connector({ slot: 'cache:redis*/console.log(\\'pwned\\')/*' })",
        ),
        true,
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('planConnector without a slot returns a generic connector', () => {
  const { files } = planConnector(
    'example',
    'Example',
    undefined,
    '/root/src/server/connectors',
  )

  assertEquals(files.map((f) => f.NAME), ['example.connector.ts'])
})

Deno.test('planConnector with --slot rest returns a REST connector', () => {
  const { files } = planConnector(
    'example',
    'Example',
    'rest',
    '/root/src/server/connectors',
  )

  assertEquals(files.map((f) => f.NAME), ['example.connector.ts'])
})

Deno.test('planConnector with --slot graphql returns a GraphQL connector', () => {
  const { files } = planConnector(
    'example',
    'Example',
    'graphql',
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
