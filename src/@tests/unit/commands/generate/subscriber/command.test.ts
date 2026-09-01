import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateSubscriberAction, { planSubscriber } from 'commands/generate/subscriber/command.ts'
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
  'generateSubscriberAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateSubscriberAction.call(
            new Commander(),
            {},
            'inventory-updates',
          ),
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
  'generateSubscriberAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateSubscriberAction.call(new Commander(), {}, '../../../../victim'),
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
  'generateSubscriberAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateSubscriberAction.call(new Commander(), {}, '123entity'),
        Error,
        "isn't a valid TypeScript identifier",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateSubscriberAction without --queue derives the queue from the name', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateSubscriberAction.call(
      new Commander(),
      {},
      'InventoryUpdates',
    )

    const filePath =
      `${projectFolder}/src/server/subscribers/inventory-updates.subscriber.handler.ts`
    const content = await Deno.readTextFile(filePath)

    assertEquals(
      content.includes(
        "import { Subscriber, ZanixSubscriber } from '@zanix/asyncmq'",
      ),
      true,
    )
    assertEquals(content.includes("@Subscriber('inventory-updates')"), true)
    assertEquals(
      content.includes(
        'export class InventoryUpdatesSubscriber extends ZanixSubscriber',
      ),
      true,
    )

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/asyncmq'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSubscriberAction with --queue uses the given queue route', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateSubscriberAction.call(
      new Commander(),
      { queue: 'custom-queue-name' },
      'InventoryUpdates',
    )

    const filePath =
      `${projectFolder}/src/server/subscribers/inventory-updates.subscriber.handler.ts`
    const content = await Deno.readTextFile(filePath)

    assertEquals(content.includes("@Subscriber('custom-queue-name')"), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSubscriberAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateSubscriberAction.call(new Commander(), {}, 'orders')
    await generateSubscriberAction.call(new Commander(), {}, 'orders')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/subscribers/orders.subscriber.handler.ts`,
    )
    assertEquals(content.includes("@Subscriber('orders')"), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSubscriberAction should never overwrite an existing subscriber', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const subscribersFolder = `${projectFolder}/src/server/subscribers`
  const filePath = `${subscribersFolder}/orders.subscriber.handler.ts`

  try {
    await Deno.mkdir(subscribersFolder, { recursive: true })
    await Deno.writeTextFile(filePath, '// customized by hand\n')

    await generateSubscriberAction.call(new Commander(), {}, 'orders')

    assertEquals(await Deno.readTextFile(filePath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  "generateSubscriberAction escapes a single quote + backslash in --queue so it can't break out " +
    'of the @Subscriber(...) string literal',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateSubscriberAction.call(
        new Commander(),
        { queue: "orders'; console.log('pwned'); //\\" },
        'InventoryUpdates',
      )

      const filePath =
        `${projectFolder}/src/server/subscribers/inventory-updates.subscriber.handler.ts`
      const content = await Deno.readTextFile(filePath)

      assertEquals(
        content.includes(
          "@Subscriber('orders\\'; console.log(\\'pwned\\'); //\\\\')",
        ),
        true,
      )
      assertEquals(
        content.includes("@Subscriber('orders'; console.log('pwned')"),
        false,
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('planSubscriber without a queue derives it from the kebab name', () => {
  const { files } = planSubscriber(
    'inventory-updates',
    'InventoryUpdates',
    undefined,
    '/root/src/server/subscribers',
  )

  assertEquals(files.map((f) => f.NAME), ['inventory-updates.subscriber.handler.ts'])
})
