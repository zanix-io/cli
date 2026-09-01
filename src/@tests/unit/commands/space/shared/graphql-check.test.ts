import { assert, assertEquals, assertThrows } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { stub } from '@std/testing/mock'
import {
  assertNoGraphqlCheckFailures,
  checkGraphqlSchemas,
  checkGraphqlSyntax,
  reportGraphqlCheckFailures,
  reportGraphqlCheckWarnings,
  runGraphqlCheck,
} from 'commands/space/shared/graphql-check.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, content)
}

/** Stubs the real `deno run` subprocess {@linkcode discoverGraphqlSchemas} spawns — same technique
 * `commands/generate/openapi/command.test.ts` already uses for `discoverRoutes`'s own subprocess.
 * Any `checkGraphqlSchemas` case that reaches at least one non-`'external'` client needs this;
 * without it, the real subprocess runs against a fixture folder with no `deno.json` of its own,
 * which cannot resolve `@zanix/core`. */
function stubDiscoverySubprocess(schemas: Record<string, string>) {
  const encoder = new TextEncoder()
  return stub(
    Deno,
    'Command',
    () =>
      ({
        output: () =>
          Promise.resolve({
            success: true,
            stdout: encoder.encode(JSON.stringify(schemas)),
            stderr: encoder.encode(''),
          }),
      }) as never,
  )
}

// --- checkGraphqlSyntax: Layer 1 -------------------------------------------------------------

Deno.test('checkGraphqlSyntax: a valid query/mutation parses with no failures', async () => {
  const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await writeFile(
      `${dir}/users.gql.ts`,
      `export const GET_USER = 'query ($id: ID!) { user(id: $id) { id name } }'
export const CREATE_USER = 'mutation ($name: String!) { createUser(name: $name) { id } }'
`,
    )

    const result = await checkGraphqlSyntax(dir)

    assertEquals(result.failures, [])
    const parsed = result.parsed.get(`${dir}/users.gql.ts`)
    assert(parsed, 'expected the file to have been parsed')
    assertEquals([...parsed.keys()].sort(), ['CREATE_USER', 'GET_USER'])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test(
  'checkGraphqlSyntax: invalid GraphQL syntax is reported naming the exact file and export',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/users.gql.ts`,
        `export const BROKEN_QUERY = 'query ( { user }'\n`,
      )

      const result = await checkGraphqlSyntax(dir)

      assertEquals(result.failures.length, 1)
      assertEquals(result.failures[0].file, `${dir}/users.gql.ts`)
      assertEquals(result.failures[0].exportName, 'BROKEN_QUERY')
      assert(result.failures[0].error.message.length > 0)
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSyntax: one broken export does not stop a sibling valid export in the SAME file, ' +
    'nor a sibling file, from being parsed — isolation across files and exports',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/users.gql.ts`,
        `export const GET_USER = 'query { user { id } }'
export const BROKEN_QUERY = 'query ( {'
`,
      )
      await writeFile(`${dir}/posts.gql.ts`, `export const GET_POSTS = 'query { posts { id } }'\n`)

      const result = await checkGraphqlSyntax(dir)

      assertEquals(result.failures.length, 1)
      assertEquals(result.failures[0].exportName, 'BROKEN_QUERY')
      assert(result.parsed.get(`${dir}/users.gql.ts`)?.has('GET_USER'))
      assert(!result.parsed.get(`${dir}/users.gql.ts`)?.has('BROKEN_QUERY'))
      assert(result.parsed.get(`${dir}/posts.gql.ts`)?.has('GET_POSTS'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSyntax: the gql/<domain>/**/*.gql.ts folder shape is discovered exactly like a ' +
    'single gql/<domain>.gql.ts file',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(`${dir}/countries/list.gql.ts`, `export const LIST = 'query { list }'\n`)
      await writeFile(
        `${dir}/countries/detail.gql.ts`,
        `export const DETAIL = 'query { detail }'\n`,
      )

      const result = await checkGraphqlSyntax(dir)

      assertEquals(result.failures, [])
      assert(result.parsed.get(`${dir}/countries/list.gql.ts`)?.has('LIST'))
      assert(result.parsed.get(`${dir}/countries/detail.gql.ts`)?.has('DETAIL'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSyntax: non-string exports (functions, numbers, objects) are silently ignored, ' +
    'never mistaken for query text',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/mixed.gql.ts`,
        `export const GET_USER = 'query { user { id } }'
export const helper = () => 'not a query'
export const COUNT = 3
export const CONFIG = { retry: true }
`,
      )

      const result = await checkGraphqlSyntax(dir)

      assertEquals(result.failures, [])
      const parsed = result.parsed.get(`${dir}/mixed.gql.ts`)
      assertEquals([...(parsed?.keys() ?? [])], ['GET_USER'])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('checkGraphqlSyntax: a non-existent directory is a clean no-op, never a crash', async () => {
  const result = await checkGraphqlSyntax(`${TMP_ROOT}/definitely-does-not-exist-${Date.now()}`)
  assertEquals(result.failures, [])
  assertEquals(result.parsed.size, 0)
})

// --- checkGraphqlSchemas: discovery/duck-typing, plus the stubbed real-subprocess match/mismatch
// --- cases above (a real, unstubbed subprocess is exercised end to end by
// --- graphql-check-schema-live.test.ts instead) --------------------------------------------------

Deno.test(
  'checkGraphqlSchemas: an export shaped like a GraphQLClient (structural — .query + .http.post) ' +
    "with schemaApplication: 'external' produces no schema failures/warnings, and never even " +
    'needs a locally compiled schema to do so',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const GET_USER = 'query { user { id } }'\n`,
      )
      await writeFile(
        `${dir}/clients/users.client.ts`,
        `export const usersClient = {
  schemaApplication: 'external',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: an export missing .http.post is NOT mistaken for a GraphQLClient, even ' +
    'when it has a .query method of its own — no crash, no false positive',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const GET_USER = 'query { user { id } }'\n`,
      )
      await writeFile(
        `${dir}/clients/users.client.ts`,
        `export const notAGraphqlClient = {
  schemaApplication: 'does-not-matter',
  query: () => 'not really a GraphQLClient',
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "checkGraphqlSchemas: a client whose schemaApplication is undefined (the project's own default) " +
    'is never reported as unmatched, even when no local schema exists at all',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const commandStub = stubDiscoverySubprocess({})
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const GET_USER = 'query { user { id } }'\n`,
      )
      await writeFile(
        `${dir}/clients/users.client.ts`,
        `export const usersClient = {
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
    } finally {
      commandStub.restore()
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: a client whose schemaApplication resolves to a real, locally discovered ' +
    'schema (via the stubbed subprocess) is validated for real — clean match and a real ' +
    'field-error mismatch alike',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const sdl = `type Query {\n  hello: String\n}\ntype Mutation {\n  _zanixMutation: String\n}\n`
    const commandStub = stubDiscoverySubprocess({ main: sdl })
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const HELLO_QUERY = 'query { hello }'
export const BROKEN_QUERY = 'query { doesNotExist }'
`,
      )
      await writeFile(
        `${dir}/clients/users.client.ts`,
        `export const usersClient = {
  schemaApplication: 'main',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.schemaFailures.length, 1)
      assertEquals(result.schemaFailures[0].exportName, 'BROKEN_QUERY')
      assert(
        result.schemaFailures[0].errors.some((message) => message.includes('doesNotExist')),
        `expected the unknown field named in the error: ${
          JSON.stringify(result.schemaFailures[0].errors)
        }`,
      )
    } finally {
      commandStub.restore()
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "checkGraphqlSchemas: a client's schemaApplication that matches no discovered schema is " +
    'reported as an unmatched warning — but ONLY because another local client in the SAME project ' +
    'DOES resolve to a real one',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const sdl = `type Query {\n  hello: String\n}\ntype Mutation {\n  _zanixMutation: String\n}\n`
    const commandStub = stubDiscoverySubprocess({ main: sdl })
    try {
      await writeFile(
        `${dir}/gql/matching.gql.ts`,
        `export const HELLO_QUERY = 'query { hello }'\n`,
      )
      await writeFile(
        `${dir}/clients/matching.client.ts`,
        `export const matchingClient = {
  schemaApplication: 'main',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )
      await writeFile(`${dir}/gql/typo.gql.ts`, `export const SOME_QUERY = 'query { hello }'\n`)
      await writeFile(
        `${dir}/clients/typo.client.ts`,
        `export const typoClient = {
  schemaApplication: 'does-not-exist',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications.length, 1)
      assertEquals(result.unmatchedApplications[0].schemaApplication, 'does-not-exist')
    } finally {
      commandStub.restore()
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: a client whose schemaApplication is undefined resolves against the ' +
    "project's own default Application ('main') — the same name `@zanix/server`'s own " +
    "DEFAULT_APPLICATION uses, verified by actually matching a discovered 'main' schema, not just " +
    'by never being reported unmatched',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const sdl = `type Query {\n  hello: String\n}\ntype Mutation {\n  _zanixMutation: String\n}\n`
    const commandStub = stubDiscoverySubprocess({ main: sdl })
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const BROKEN_QUERY = 'query { doesNotExist }'\n`,
      )
      await writeFile(
        `${dir}/clients/users.client.ts`,
        `export const usersClient = {
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.schemaFailures.length, 1)
      assertEquals(result.schemaFailures[0].exportName, 'BROKEN_QUERY')
      assertEquals(result.schemaFailures[0].schemaApplication, '(default)')
    } finally {
      commandStub.restore()
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: a client file that fails to import is skipped, never surfaced as a ' +
    "GraphQL check failure of its own — that's a different problem, reported elsewhere",
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const GET_USER = 'query { user { id } }'\n`,
      )
      await writeFile(`${dir}/clients/broken.client.ts`, `this is not valid TypeScript at all (\n`)

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: a **/*.client.ts file under node_modules/ is never discovered — ' +
    'excluded directories are never walked at all',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/users.gql.ts`,
        `export const GET_USER = 'query { user { id } }'\n`,
      )
      // Deliberately unimportable — proves this file is never even REACHED, not merely skipped
      // after a failed import (the previous test already covers that different case).
      await writeFile(
        `${dir}/node_modules/some-pkg/broken.client.ts`,
        `this is not valid TypeScript at all (\n`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- checkGraphqlSchemas: Case B, schemaApplication: { external: true } ---------------------

Deno.test(
  'checkGraphqlSchemas: a client whose schemaApplication is { external: true } and HAS a cached ' +
    'gql/<name>.schema.graphql validates matching queries against it for real — a clean match and ' +
    'a real field-error mismatch alike, never needing the local-subprocess path at all',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/countries.gql.ts`,
        `export const GET_COUNTRY = 'query { country(code: "CL") { name } }'
export const GET_GHOST = 'query { ghostField }'
`,
      )
      await writeFile(
        `${dir}/gql/countries.schema.graphql`,
        `type Country {
  name: String
}

type Query {
  country(code: String!): Country
}
`,
      )
      await writeFile(
        `${dir}/clients/countries.client.ts`,
        `export const countriesClient = {
  schemaApplication: { external: true },
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.missingExternalCaches, [])
      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.schemaFailures.length, 1)
      assertEquals(result.schemaFailures[0].exportName, 'GET_GHOST')
      assertEquals(result.schemaFailures[0].schemaApplication, 'external')
      assert(result.schemaFailures[0].errors[0].includes('ghostField'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: a client whose schemaApplication is { external: true } but has NO cached ' +
    'gql/<name>.schema.graphql yet is reported as a missing-cache warning, never a schema failure ' +
    '— the project just never ran `zanix generate graphql-schema`',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/countries.gql.ts`,
        `export const GET_COUNTRY = 'query { country(code: "CL") { name } }'\n`,
      )
      await writeFile(
        `${dir}/clients/countries.client.ts`,
        `export const countriesClient = {
  schemaApplication: { external: true },
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.missingExternalCaches, [
        {
          clientFile: `${dir}/clients/countries.client.ts`,
          cachePath: `${dir}/gql/countries.schema.graphql`,
        },
      ])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  "checkGraphqlSchemas: a plain schemaApplication: 'external' client is unaffected by a stray " +
    'gql/<name>.schema.graphql on disk — the object form is the only opt-in into the cache-match ' +
    'path, the string form stays syntax-only',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/countries.gql.ts`,
        `export const GET_GHOST = 'query { ghostField }'\n`,
      )
      await writeFile(
        `${dir}/gql/countries.schema.graphql`,
        `type Query {
  realField: String
}
`,
      )
      await writeFile(
        `${dir}/clients/countries.client.ts`,
        `export const countriesClient = {
  schemaApplication: 'external',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.missingExternalCaches, [])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'checkGraphqlSchemas: a client whose schemaApplication is { external: true } and HAS a cached ' +
    'schema, but no matching gql/<name>.gql.ts content at all, produces no failures — nothing to ' +
    'validate against it',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeFile(
        `${dir}/gql/countries.schema.graphql`,
        `type Query {
  realField: String
}
`,
      )
      await writeFile(
        `${dir}/clients/countries.client.ts`,
        `export const countriesClient = {
  schemaApplication: { external: true },
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )

      // No gql/countries.gql.ts at all — `parsed` stays empty for this client.
      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.schemaFailures, [])
      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.missingExternalCaches, [])
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

// --- runGraphqlCheck: opt-out shape --------------------------------------------------------

Deno.test(
  'runGraphqlCheck: a project with no gql/ directory at all is a total no-op — never even walks ' +
    'the project for **/*.client.ts files',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // If client discovery ran anyway, this unimportable file would surface some effect (or at
      // least be walked) — asserting a clean, empty result proves the whole check short-circuited
      // on the missing gql/ directory, matching messagesDir's own "opt-out only means something
      // when the feature is configured" shape.
      await writeFile(`${root}/clients/whatever.client.ts`, `this is not valid TypeScript (\n`)

      const result = await runGraphqlCheck(root, root)

      assertEquals(result, {
        syntaxFailures: [],
        schemaFailures: [],
        unmatchedApplications: [],
        missingExternalCaches: [],
      })
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// --- assertNoGraphqlCheckFailures / reportGraphqlCheckFailures / reportGraphqlCheckWarnings ---

Deno.test('assertNoGraphqlCheckFailures: a no-op for a clean result', () => {
  assertNoGraphqlCheckFailures({
    syntaxFailures: [],
    schemaFailures: [],
    unmatchedApplications: [],
    missingExternalCaches: [],
  })
})

Deno.test(
  'assertNoGraphqlCheckFailures: throws one aggregate Error naming every syntax AND schema failure',
  () => {
    const error = assertThrows(
      () =>
        assertNoGraphqlCheckFailures({
          syntaxFailures: [
            { file: 'gql/users.gql.ts', exportName: 'BROKEN', error: new Error('bad syntax') },
          ],
          schemaFailures: [
            {
              file: 'gql/users.gql.ts',
              exportName: 'MISMATCH',
              clientFile: 'clients/users.client.ts',
              schemaApplication: 'main',
              errors: ['Cannot query field "ghost"'],
            },
          ],
          unmatchedApplications: [],
          missingExternalCaches: [],
        }),
      Error,
    )
    assert(error.message.includes('2 GraphQL query/mutation issue'))
    assert(error.message.includes('BROKEN'))
    assert(error.message.includes('bad syntax'))
    assert(error.message.includes('MISMATCH'))
    assert(error.message.includes('Cannot query field "ghost"'))
  },
)

Deno.test('reportGraphqlCheckFailures: returns false and logs nothing for a clean result', () => {
  const reported = reportGraphqlCheckFailures({
    syntaxFailures: [],
    schemaFailures: [],
    unmatchedApplications: [],
    missingExternalCaches: [],
  })
  assertEquals(reported, false)
})

Deno.test('reportGraphqlCheckFailures: returns true when there is at least one failure', () => {
  const reported = reportGraphqlCheckFailures({
    syntaxFailures: [{ file: 'gql/users.gql.ts', exportName: 'BROKEN', error: new Error('bad') }],
    schemaFailures: [],
    unmatchedApplications: [],
    missingExternalCaches: [],
  })
  assertEquals(reported, true)
})

Deno.test('reportGraphqlCheckWarnings: a no-op for zero unmatched applications', () => {
  reportGraphqlCheckWarnings({
    syntaxFailures: [],
    schemaFailures: [],
    unmatchedApplications: [],
    missingExternalCaches: [],
  })
})

Deno.test('reportGraphqlCheckWarnings: never throws for a non-empty unmatchedApplications list', () => {
  reportGraphqlCheckWarnings({
    syntaxFailures: [],
    schemaFailures: [],
    unmatchedApplications: [
      { clientFile: 'clients/users.client.ts', schemaApplication: 'does-not-exist' },
    ],
    missingExternalCaches: [],
  })
})

Deno.test('reportGraphqlCheckWarnings: never throws for a non-empty missingExternalCaches list', () => {
  reportGraphqlCheckWarnings({
    syntaxFailures: [],
    schemaFailures: [],
    unmatchedApplications: [],
    missingExternalCaches: [
      { clientFile: 'clients/countries.client.ts', cachePath: 'gql/countries.schema.graphql' },
    ],
  })
})
