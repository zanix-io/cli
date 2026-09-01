import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateOpenapiAction, {
  planOpenapi,
  registerOpenapiCommand,
} from 'commands/generate/openapi/command.ts'
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

/** Stubs the real subprocess `discoverRoutes` spawns — a unit test never runs a real `deno run`. */
function stubDiscoverySubprocess(routes: unknown[]) {
  const encoder = new TextEncoder()
  return stub(
    Deno,
    'Command',
    () =>
      ({
        output: () =>
          Promise.resolve({
            success: true,
            stdout: encoder.encode(JSON.stringify(routes)),
            stderr: new Uint8Array(),
          }),
      }) as never,
  )
}

function stubFailedDiscoverySubprocess(stderr: string) {
  return stub(
    Deno,
    'Command',
    () =>
      ({
        output: () =>
          Promise.resolve({
            success: false,
            stdout: new Uint8Array(),
            stderr: new TextEncoder().encode(stderr),
          }),
      }) as never,
  )
}

Deno.test('generateOpenapiAction should throw outside a server/space-server project', async () => {
  const projectFolder = await makeProject('library')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateOpenapiAction.call(new Commander(), {}),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateOpenapiAction writes openapi.json for every discovered route', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const commandStub = stubDiscoverySubprocess([
    { httpMethod: 'GET', path: '/items', application: 'main' },
  ])

  try {
    await generateOpenapiAction.call(new Commander(), {})

    const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
    assertEquals(content.paths['/items'].get.tags, ['main'])
  } finally {
    commandStub.restore()
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateOpenapiAction overwrites an existing openapi.json on every run', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  await Deno.writeTextFile(`${projectFolder}/openapi.json`, '{"stale": true}')
  const commandStub = stubDiscoverySubprocess([
    { httpMethod: 'GET', path: '/items', application: 'main' },
  ])

  try {
    await generateOpenapiAction.call(new Commander(), {})

    const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
    assertEquals('stale' in content, false)
    assertEquals(content.openapi, '3.0.3')
  } finally {
    commandStub.restore()
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateOpenapiAction --application filters routes to that Application', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const commandStub = stubDiscoverySubprocess([
    { httpMethod: 'GET', path: '/items', application: 'main' },
    { httpMethod: 'GET', path: '/admin/items', application: 'admin' },
  ])

  try {
    await generateOpenapiAction.call(new Commander(), { application: 'admin' })

    const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
    assertEquals(Object.keys(content.paths), ['/admin/items'])
  } finally {
    commandStub.restore()
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateOpenapiAction forwards --include-admin to discoverRoutes', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  let capturedArgs: string[] = []
  const commandStub = stub(
    Deno,
    'Command',
    (_exe: unknown, options: unknown) => {
      capturedArgs = (options as { args: string[] }).args
      return {
        output: () =>
          Promise.resolve({
            success: true,
            stdout: new TextEncoder().encode('[]'),
            stderr: new Uint8Array(),
          }),
      } as never
    },
  )

  try {
    await generateOpenapiAction.call(new Commander(), { includeAdmin: true })
    assertEquals(capturedArgs.at(-1), '1')
  } finally {
    commandStub.restore()
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateOpenapiAction without --include-admin forwards "0" to discoverRoutes',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    let capturedArgs: string[] = []
    const commandStub = stub(
      Deno,
      'Command',
      (_exe: unknown, options: unknown) => {
        capturedArgs = (options as { args: string[] }).args
        return {
          output: () =>
            Promise.resolve({
              success: true,
              stdout: new TextEncoder().encode('[]'),
              stderr: new Uint8Array(),
            }),
        } as never
      },
    )

    try {
      await generateOpenapiAction.call(new Commander(), {})
      assertEquals(capturedArgs.at(-1), '0')
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateOpenapiAction --include-admin includes a discovered admin route by default (no --application)',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const commandStub = stubDiscoverySubprocess([
      { httpMethod: 'GET', path: '/items', application: 'main' },
      { httpMethod: 'POST', path: '/admin/service-token', application: 'admin' },
    ])

    try {
      await generateOpenapiAction.call(new Commander(), { includeAdmin: true })

      const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
      assertEquals(Object.keys(content.paths).sort(), ['/admin/service-token', '/items'])
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateOpenapiAction --include-admin --application admin narrows down to just admin routes',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const commandStub = stubDiscoverySubprocess([
      { httpMethod: 'GET', path: '/items', application: 'main' },
      { httpMethod: 'POST', path: '/admin/service-token', application: 'admin' },
    ])

    try {
      await generateOpenapiAction.call(new Commander(), {
        includeAdmin: true,
        application: 'admin',
      })

      const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
      assertEquals(Object.keys(content.paths), ['/admin/service-token'])
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateOpenapiAction --application main still narrows down when --include-admin is also set',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const commandStub = stubDiscoverySubprocess([
      { httpMethod: 'GET', path: '/items', application: 'main' },
      { httpMethod: 'POST', path: '/admin/service-token', application: 'admin' },
    ])

    try {
      await generateOpenapiAction.call(new Commander(), {
        includeAdmin: true,
        application: 'main',
      })

      const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
      assertEquals(Object.keys(content.paths), ['/items'])
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateOpenapiAction surfaces a graceful error when { admin: true } is unsupported',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const commandStub = stubFailedDiscoverySubprocess('ZANIX_COMPOSE_ADMIN_UNSUPPORTED\n')

    try {
      await assertRejects(
        () => generateOpenapiAction.call(new Commander(), { includeAdmin: true }),
        Error,
        'upgrade @zanix/core',
      )
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateOpenapiAction with no --application keeps every discovered route', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const commandStub = stubDiscoverySubprocess([
    { httpMethod: 'GET', path: '/items', application: 'main' },
    { httpMethod: 'GET', path: '/admin/items', application: 'admin' },
  ])

  try {
    await generateOpenapiAction.call(new Commander(), {})

    const content = JSON.parse(await Deno.readTextFile(`${projectFolder}/openapi.json`))
    assertEquals(Object.keys(content.paths).sort(), ['/admin/items', '/items'])
  } finally {
    commandStub.restore()
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateOpenapiAction surfaces a graceful, actionable error when Zanix.compose is unsupported',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const commandStub = stubFailedDiscoverySubprocess('ZANIX_COMPOSE_UNSUPPORTED\n')

    try {
      await assertRejects(
        () => generateOpenapiAction.call(new Commander(), {}),
        Error,
        'upgrade @zanix/core',
      )
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'registerOpenapiCommand should wire the real actionHandler to generateOpenapiAction',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const commandStub = stubDiscoverySubprocess([])
    const cwd = new Commander()
    registerOpenapiCommand(cwd)
    type ActionCommand = {
      settings: { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.settings.actionHandler({})

      const content = await Deno.readTextFile(`${projectFolder}/openapi.json`)
      assertEquals(JSON.parse(content).paths, {})
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('planOpenapi renders the spec as indented JSON text ending in a newline', () => {
  const text = planOpenapi([{ httpMethod: 'GET', path: '/items', application: 'main' }])
  assertEquals(text.endsWith('\n'), true)
  assertEquals(JSON.parse(text).paths['/items'].get.tags, ['main'])
})
