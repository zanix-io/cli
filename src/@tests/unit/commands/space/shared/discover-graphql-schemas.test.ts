import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { discoverGraphqlSchemas } from 'commands/space/shared/discover-graphql-schemas.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProjectRoot(): Promise<string> {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(root, { recursive: true })
  return root
}

function stubCommandOutput(
  output: { success: boolean; stdout?: string; stderr?: string },
) {
  const encoder = new TextEncoder()
  return stub(
    Deno,
    'Command',
    () =>
      ({
        output: () =>
          Promise.resolve({
            success: output.success,
            stdout: encoder.encode(output.stdout ?? ''),
            stderr: encoder.encode(output.stderr ?? ''),
          }),
      }) as never,
  )
}

Deno.test(
  'discoverGraphqlSchemas parses the {application: sdl} map the subprocess prints to stdout',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: true,
      stdout: JSON.stringify({ main: 'type Query {\n  hello: String\n}\n' }),
    })

    try {
      const schemas = await discoverGraphqlSchemas(root)
      assertEquals(schemas, { main: 'type Query {\n  hello: String\n}\n' })
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('discoverGraphqlSchemas returns {} for blank stdout', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({ success: true, stdout: '' })

  try {
    assertEquals(await discoverGraphqlSchemas(root), {})
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('discoverGraphqlSchemas returns {} for a real "no Application registered" run too', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({ success: true, stdout: '{}' })

  try {
    assertEquals(await discoverGraphqlSchemas(root), {})
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('discoverGraphqlSchemas removes its own temp script file after a successful run', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({ success: true, stdout: '{}' })

  try {
    await discoverGraphqlSchemas(root)
    const entries = [...(await Array.fromAsync(Deno.readDir(root)))]
    assertEquals(entries.length, 0)
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('discoverGraphqlSchemas removes its own temp script file after a failed run too', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({ success: false, stderr: 'something unrelated broke' })

  try {
    await assertRejects(() => discoverGraphqlSchemas(root))
    const entries = [...(await Array.fromAsync(Deno.readDir(root)))]
    assertEquals(entries.length, 0)
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  'discoverGraphqlSchemas throws a clear, actionable error when Zanix.compose is unsupported',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'ZANIX_COMPOSE_UNSUPPORTED\n',
    })

    try {
      await assertRejects(
        () => discoverGraphqlSchemas(root),
        Error,
        'Zanix.compose()',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverGraphqlSchemas throws a clear, actionable error when the resolved @zanix/server/graphql ' +
    'predates defineSchema/getSchema/getSchemaApplications',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'ZANIX_GRAPHQL_SCHEMA_API_UNSUPPORTED\n',
    })

    try {
      await assertRejects(
        () => discoverGraphqlSchemas(root),
        Error,
        'defineSchema()/getSchema()/getSchemaApplications()',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverGraphqlSchemas surfaces the raw stderr for a subprocess failure matching no sentinel',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'some real error thrown while importing a project handler',
    })

    try {
      const error = await assertRejects(() => discoverGraphqlSchemas(root), Error)
      assert(error.message.includes('some real error thrown while importing a project handler'))
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('discoverGraphqlSchemas forwards rootDir to the subprocess as its second CLI arg', async () => {
  const root = await makeProjectRoot()
  let capturedArgs: string[] = []
  const encoder = new TextEncoder()
  const commandStub = stub(
    Deno,
    'Command',
    (_cmd: unknown, options: unknown) => {
      capturedArgs = (options as { args: string[] }).args
      return {
        output: () =>
          Promise.resolve({
            success: true,
            stdout: encoder.encode('{}'),
            stderr: encoder.encode(''),
          }),
      } as never
    },
  )

  try {
    await discoverGraphqlSchemas(root, 'src/server')
    assertEquals(capturedArgs.at(-1), 'src/server')
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})
