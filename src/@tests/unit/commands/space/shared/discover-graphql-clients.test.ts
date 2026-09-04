import { assert, assertEquals, assertRejects } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { stub } from '@std/testing/mock'
import {
  clientBaseName,
  collectFiles,
  isCheckedExternalSchemaApplication,
  isExternalSchemaApplication,
  looksLikeGraphqlClient,
} from 'commands/space/shared/discover-graphql-clients.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

// --- looksLikeGraphqlClient: every branch, not just the ones graphql-check.test.ts happens to
// --- reach through full discovery ---------------------------------------------------------------

Deno.test('looksLikeGraphqlClient: null/undefined/a primitive is never mistaken for a client', () => {
  assertEquals(looksLikeGraphqlClient(null), false)
  assertEquals(looksLikeGraphqlClient(undefined), false)
  assertEquals(looksLikeGraphqlClient('a string export'), false)
  assertEquals(looksLikeGraphqlClient(42), false)
})

Deno.test('looksLikeGraphqlClient: an object with no .query at all (not just a non-function one) is rejected', () => {
  assertEquals(looksLikeGraphqlClient({ http: { post: () => {} } }), false)
})

Deno.test('looksLikeGraphqlClient: .query present but .http missing entirely is rejected', () => {
  assertEquals(looksLikeGraphqlClient({ query: () => {} }), false)
})

Deno.test(
  'looksLikeGraphqlClient: a real .query + .http.post shape (regardless of extra own fields) is accepted',
  () => {
    assertEquals(
      looksLikeGraphqlClient({
        query: () => {},
        http: { post: () => {} },
        schemaApplication: { external: true },
      }),
      true,
    )
  },
)

// --- isExternalSchemaApplication / isCheckedExternalSchemaApplication: every SchemaApplication shape

Deno.test('isExternalSchemaApplication / isCheckedExternalSchemaApplication: the three real shapes', () => {
  assertEquals(isExternalSchemaApplication('main'), false)
  assertEquals(isExternalSchemaApplication(undefined), false)
  assertEquals(isExternalSchemaApplication('external'), true)
  assertEquals(isExternalSchemaApplication({ external: true }), true)

  assertEquals(isCheckedExternalSchemaApplication('external'), false)
  assertEquals(isCheckedExternalSchemaApplication({ external: true }), true)
  assertEquals(isCheckedExternalSchemaApplication(null), false)
  assertEquals(isCheckedExternalSchemaApplication({ external: false }), false)
})

// --- clientBaseName: the same derivation Layer 2 and the generator both rely on -----------------

Deno.test('clientBaseName: strips the .client.ts suffix off a nested path', () => {
  assertEquals(clientBaseName('/proj/src/space/clients/countries.client.ts'), 'countries')
})

// --- collectFiles: the non-NotFound rethrow branch -----------------------------------------------

Deno.test('collectFiles: a real (non-NotFound) Deno.readDir error propagates, never swallowed', async () => {
  const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    const readDirStub = stub(Deno, 'readDir', () => {
      throw new Deno.errors.PermissionDenied('nope')
    })
    try {
      await assertRejects(
        () => collectFiles(dir, '.client.ts'),
        Deno.errors.PermissionDenied,
      )
    } finally {
      readDirStub.restore()
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('collectFiles: a genuinely missing directory resolves to an empty list, never throws', async () => {
  const result = await collectFiles(
    `${TMP_ROOT}/does-not-exist-${crypto.randomUUID()}`,
    '.client.ts',
  )
  assert(Array.isArray(result))
  assertEquals(result, [])
})
