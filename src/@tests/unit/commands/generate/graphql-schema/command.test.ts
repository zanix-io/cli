import { assert, assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { stub } from '@std/testing/mock'
import generateGraphqlSchemaAction, {
  planGraphqlSchemaTargets,
  registerGraphqlSchemaCommand,
  writeGraphqlSchemaCaches,
} from 'commands/generate/graphql-schema/command.ts'
import { Commander } from 'cli'
import type { DiscoveredGraphqlClient } from 'commands/space/shared/discover-graphql-clients.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function makeProject(zanixProject: string): Promise<string> {
  const projectFolder = await Deno.makeTempDir({ dir: TMP_ROOT })
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({ zanix: { project: zanixProject } }),
  )
  return projectFolder
}

function fakeDiscoveredClient(
  overrides: Partial<DiscoveredGraphqlClient> = {},
): DiscoveredGraphqlClient {
  return {
    file: 'clients/countries.client.ts',
    exportName: 'countriesClient',
    schemaApplication: { external: true },
    instance: {
      query: () => Promise.resolve({ data: {} }),
      http: { post: () => Promise.resolve({}) },
      schemaApplication: { external: true },
      introspect: () => Promise.resolve({}),
    },
    ...overrides,
  }
}

// --- planGraphqlSchemaTargets: pure filtering -------------------------------------------------

Deno.test(
  'planGraphqlSchemaTargets: keeps only schemaApplication: { external: true } clients, deriving ' +
    "each one's cachePath from clientBaseName",
  () => {
    const clients: DiscoveredGraphqlClient[] = [
      fakeDiscoveredClient({ file: 'clients/countries.client.ts' }),
      fakeDiscoveredClient({ file: 'clients/users.client.ts', schemaApplication: 'external' }),
      fakeDiscoveredClient({ file: 'clients/main.client.ts', schemaApplication: 'main' }),
      fakeDiscoveredClient({ file: 'clients/default.client.ts', schemaApplication: undefined }),
    ]

    const targets = planGraphqlSchemaTargets(clients, '/proj/src/space/gql')

    assertEquals(targets.length, 1)
    assertEquals(targets[0].file, 'clients/countries.client.ts')
    assertEquals(targets[0].cachePath, '/proj/src/space/gql/countries.schema.graphql')
  },
)

Deno.test('planGraphqlSchemaTargets: an empty client list plans zero targets', () => {
  assertEquals(planGraphqlSchemaTargets([], '/proj/src/space/gql'), [])
})

// --- writeGraphqlSchemaCaches: real introspect() + SDL conversion + write ---------------------

Deno.test(
  'writeGraphqlSchemaCaches: a target whose introspect() resolves with a real introspection ' +
    'result is written as real, printable SDL text',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const { buildSchema, introspectionFromSchema } = await import('graphql')
      const schema = buildSchema('type Query {\n  hello: String\n}\n')
      const introspection = introspectionFromSchema(schema)

      const cachePath = `${dir}/countries.schema.graphql`
      const { written, failures } = await writeGraphqlSchemaCaches([{
        file: 'clients/countries.client.ts',
        exportName: 'countriesClient',
        cachePath,
        instance: {
          query: () => Promise.resolve({ data: {} }),
          http: { post: () => Promise.resolve({}) },
          introspect: () => Promise.resolve(introspection as unknown as Record<string, unknown>),
        },
      }], dir)

      assertEquals(failures, [])
      assertEquals(written, [cachePath])
      const sdl = await Deno.readTextFile(cachePath)
      assert(sdl.includes('AUTO-GENERATED'))
      assert(sdl.includes('type Query'))
      assert(sdl.includes('hello: String'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'writeGraphqlSchemaCaches: a target whose introspect() throws is reported as a failure, and no ' +
    'cache file is written for it',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const cachePath = `${dir}/broken.schema.graphql`
      const { written, failures } = await writeGraphqlSchemaCaches([{
        file: 'clients/broken.client.ts',
        exportName: 'brokenClient',
        cachePath,
        instance: {
          query: () => Promise.resolve({ data: {} }),
          http: { post: () => Promise.resolve({}) },
          introspect: () => Promise.reject(new Error('introspection disabled')),
        },
      }], dir)

      assertEquals(written, [])
      assertEquals(failures.length, 1)
      assertEquals(failures[0].file, 'clients/broken.client.ts')
      assert(failures[0].error.message.includes('introspection disabled'))
      await assertRejects(() => Deno.stat(cachePath))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'writeGraphqlSchemaCaches: one target failing never stops another, independently successful, ' +
    'target from being written',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const { buildSchema, introspectionFromSchema } = await import('graphql')
      const schema = buildSchema('type Query {\n  ok: String\n}\n')
      const introspection = introspectionFromSchema(schema)

      const okPath = `${dir}/ok.schema.graphql`
      const brokenPath = `${dir}/broken.schema.graphql`
      const { written, failures } = await writeGraphqlSchemaCaches([
        {
          file: 'clients/ok.client.ts',
          exportName: 'okClient',
          cachePath: okPath,
          instance: {
            query: () => Promise.resolve({ data: {} }),
            http: { post: () => Promise.resolve({}) },
            introspect: () => Promise.resolve(introspection as unknown as Record<string, unknown>),
          },
        },
        {
          file: 'clients/broken.client.ts',
          exportName: 'brokenClient',
          cachePath: brokenPath,
          instance: {
            query: () => Promise.resolve({ data: {} }),
            http: { post: () => Promise.resolve({}) },
            introspect: () => Promise.reject(new Error('network down')),
          },
        },
      ], dir)

      assertEquals(written, [okPath])
      assertEquals(failures.length, 1)
      assertEquals(failures[0].file, 'clients/broken.client.ts')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'writeGraphqlSchemaCaches: a target whose instance has no .introspect() function at all is ' +
    'reported as a clear failure, never a crash',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const cachePath = `${dir}/no-introspect.schema.graphql`
      const { written, failures } = await writeGraphqlSchemaCaches([{
        file: 'clients/no-introspect.client.ts',
        exportName: 'noIntrospectClient',
        cachePath,
        instance: {
          query: () => Promise.resolve({ data: {} }),
          http: { post: () => Promise.resolve({}) },
        },
      }], dir)

      assertEquals(written, [])
      assertEquals(failures.length, 1)
      assert(failures[0].error.message.includes('.introspect()'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'writeGraphqlSchemaCaches: a target whose introspect() rejects with a non-Error value is still ' +
    'reported as a real Error, never left as the raw thrown value',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const cachePath = `${dir}/weird.schema.graphql`
      const { written, failures } = await writeGraphqlSchemaCaches([{
        file: 'clients/weird.client.ts',
        exportName: 'weirdClient',
        cachePath,
        instance: {
          query: () => Promise.resolve({ data: {} }),
          http: { post: () => Promise.resolve({}) },
          introspect: () => Promise.reject('a raw string rejection'),
        },
      }], dir)

      assertEquals(written, [])
      assertEquals(failures.length, 1)
      assert(failures[0].error instanceof Error)
      assert(failures[0].error.message.includes('a raw string rejection'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- generateGraphqlSchemaAction: real orchestration -------------------------------------------

Deno.test('generateGraphqlSchemaAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateGraphqlSchemaAction.call(new Commander(), {}),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateGraphqlSchemaAction: zero { external: true } clients is a clean no-op — never throws, ' +
    'never writes anything',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateGraphqlSchemaAction.call(new Commander(), {})
      await assertRejects(() => Deno.stat(`${projectFolder}/src/space/gql`))
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateGraphqlSchemaAction: a real { external: true } client is introspected for real and ' +
    'cached to gql/<name>.schema.graphql',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await writeFile(
        `${projectFolder}/src/space/clients/countries.client.ts`,
        `import { buildSchema, introspectionFromSchema } from 'graphql'

const schema = buildSchema('type Query {\\n  hello: String\\n}\\n')

export const countriesClient = {
  schemaApplication: { external: true },
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
  introspect: () => Promise.resolve(introspectionFromSchema(schema)),
}
`,
      )

      await generateGraphqlSchemaAction.call(new Commander(), {})

      const sdl = await Deno.readTextFile(
        `${projectFolder}/src/space/gql/countries.schema.graphql`,
      )
      assert(sdl.includes('hello: String'))
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateGraphqlSchemaAction: a client whose introspect() fails throws one aggregate Error ' +
    'naming it, after every other target already got its own real attempt',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await writeFile(
        `${projectFolder}/src/space/clients/broken.client.ts`,
        `export const brokenClient = {
  schemaApplication: { external: true },
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
  introspect: () => Promise.reject(new Error('introspection disabled')),
}
`,
      )

      await assertRejects(
        () => generateGraphqlSchemaAction.call(new Commander(), {}),
        Error,
        'introspection disabled',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'registerGraphqlSchemaCommand should wire the real actionHandler to generateGraphqlSchemaAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerGraphqlSchemaCommand(cwd)
    type ActionCommand = {
      settings: { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      // Zero clients — proves the real actionHandler is wired without needing a fixture client.
      await command.settings.actionHandler({})
      await assertRejects(() => Deno.stat(`${projectFolder}/src/space/gql`))
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
