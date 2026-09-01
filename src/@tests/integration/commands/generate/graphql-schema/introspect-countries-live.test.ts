import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { writeGraphqlSchemaCaches } from 'commands/generate/graphql-schema/command.ts'
import { checkGraphqlSchemas, checkGraphqlSyntax } from 'commands/space/shared/graphql-check.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, content)
}

/**
 * `-live`, same convention `nested-classmetadata-live.test.ts`/`graphql-check-schema-live.test.ts`
 * already use: a REAL network call against `https://countries.trevorblades.com/graphql` — the
 * exact same public, introspection-enabled GraphQL API `@zanix/server`'s own real
 * `GraphQLClient.introspect()` test already used to confirm that method works end to end. Never
 * stubbed here — this file's whole point is proving `writeGraphqlSchemaCaches`'s real
 * `.introspect()` → `introspectionToSdl` → cache-file pipeline, and Layer 2's real
 * `{ external: true }` cache-match path, both work against a genuinely live schema, not a fixture
 * standing in for one.
 *
 * Excluded from the default fast suite the same way every other `-live` test is (see this
 * project's own CI config) — run directly when touching this pipeline.
 *
 * @module
 */
Deno.test(
  'writeGraphqlSchemaCaches (real network): a real { external: true } client against the live ' +
    'countries.trevorblades.com API is introspected and cached as real, valid SDL text — then ' +
    'Layer 2 validates a real query against that exact cache with zero false positives, and a ' +
    'genuinely broken query against it for real',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      const cachePath = `${dir}/gql/countries.schema.graphql`

      const { written, failures } = await writeGraphqlSchemaCaches([{
        file: `${dir}/clients/countries.client.ts`,
        exportName: 'countriesClient',
        cachePath,
        instance: {
          query: () => Promise.resolve({ data: {} }),
          http: { post: () => Promise.resolve({}) },
          // The REAL, full introspection query `graphql-js` itself defines (`getIntrospectionQuery()`
          // — the exact same query, byte for byte, `@zanix/server`'s own `GraphQLClient.introspect()`
          // sends, per that method's own doc) — never a hand-rolled, partial one. A partial query
          // (queryType/types names only, no `inputFields`/`possibleTypes`/...) is a real, confirmed
          // way for `buildClientSchema()` to fail on a real schema with input types — caught while
          // writing this very test, not hypothetical.
          introspect: async () => {
            const { getIntrospectionQuery } = await import('graphql')
            const response = await fetch('https://countries.trevorblades.com/graphql', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ query: getIntrospectionQuery() }),
            })
            const { data } = await response.json()
            return data
          },
        },
      }], dir)

      assertEquals(failures, [])
      assertEquals(written, [cachePath])

      const sdl = await Deno.readTextFile(cachePath)
      assert(sdl.includes('type Query'), `expected real SDL, got:\n${sdl}`)
      assert(sdl.includes('type Country'), `expected the real Countries API shape, got:\n${sdl}`)

      // Layer 2's own cache-match path, against the exact file just written above — a real query
      // matches cleanly, a genuinely broken one is reported with the real field name.
      await writeFile(
        `${dir}/clients/countries.client.ts`,
        `export const countriesClient = {
  schemaApplication: { external: true },
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )
      await writeFile(
        `${dir}/gql/countries.gql.ts`,
        `export const GET_COUNTRIES = 'query { countries { code name } }'
export const BROKEN = 'query { countries { thisFieldDoesNotExist } }'
`,
      )

      const syntax = await checkGraphqlSyntax(`${dir}/gql`)
      const result = await checkGraphqlSchemas(dir, `${dir}/gql`, syntax.parsed)

      assertEquals(result.missingExternalCaches, [])
      assertEquals(result.schemaFailures.length, 1)
      assertEquals(result.schemaFailures[0].exportName, 'BROKEN')
      assert(result.schemaFailures[0].errors[0].includes('thisFieldDoesNotExist'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
