import { assert, assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { runGraphqlCheck } from 'commands/space/shared/graphql-check.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * Layer 2's real, end-to-end behavior — a real `deno run` subprocess (`discoverGraphqlSchemas`,
 * `discover-graphql-schemas.ts`), rooted at a real scaffolded project, running a real
 * `Zanix.compose(rootDir)`. `-live` in this file's own name: it depends on real, currently-published
 * `@zanix/core`/`@zanix/datamaster`/`@zanix/auth`/`@zanix/notifications`/`@zanix/asyncmq` (all
 * transitively pulled in by `Zanix.compose`'s own `defineCoreMetadata`), the same "-live" convention
 * `space-icons-live.test.ts`/`nested-classmetadata-live.test.ts` already use.
 *
 * `@zanix/server`/`@zanix/server/graphql` are overridden straight to the local checkout in every
 * scaffold's own `deno.json` below, the same technique `nested-classmetadata-live.test.ts` already
 * establishes for `@zanix/utils`: `defineSchema`/`getSchema`/`getSchemaApplications` (needed here)
 * aren't on the real, currently-published `@zanix/server@4.0.0/graphql` yet (verified directly
 * against `https://jsr.io/@zanix/server/meta.json` — that subpath exports only
 * `Mutation`/`Query`/`Request`/`Resolver`/`ZanixResolver` today).
 *
 * Each scaffold below writes its own `deno.json` — Deno's own workspace resolution stops applying
 * the moment a folder has its own config file (confirmed empirically: without this, `@zanix/core`
 * isn't even in scope, since `cli` itself never depends on it), so every dependency the subprocess
 * needs is declared explicitly, not inherited.
 *
 * The real resolver file is written as `<name>.resolver.handler.ts` — the exact suffix
 * `zanix generate handler --type graphql` actually writes (`handler/command.ts`'s own
 * `HANDLER_TYPES`). Confirmed directly against `@zanix/server`'s own real, published
 * `ZANIX_SERVER_MODULES` (`utils/constants.ts`): it lists only `.handler.ts`/`.interactor.ts`/
 * `.connector.ts`/`.provider.ts`/`.defs.ts` — a plain `endsWith` check (`@zanix/helpers`'s
 * `collectFiles`), so `.resolver.handler.ts` matches (it ends in `.handler.ts`) while the older,
 * now-fixed `.resolver.ts` suffix never did. See `discovery-live.test.ts` (`commands/generate/
 * handler/`) for the dedicated regression test of that fix across all 4 handler `--type`s.
 *
 * @module
 */

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

/** The local `@zanix/server` checkout this repo's own `deno.jsonc` already assumes as a real
 * sibling folder — same convention `nested-classmetadata-live.test.ts` already applies for
 * `@zanix/utils`. */
const SERVER_CHECKOUT = join(dirname(fromFileUrl(import.meta.url)), '../../../../../../../server')

async function writeScaffoldDenoJson(root: string): Promise<void> {
  await writeFile(
    join(root, 'deno.json'),
    JSON.stringify({
      imports: {
        '@zanix/core': 'jsr:@zanix/core@^3.0.0',
        '@zanix/server': `${SERVER_CHECKOUT}/mod.ts`,
        '@zanix/server/graphql': `${SERVER_CHECKOUT}/src/modules/infra/handlers/graphql/mod.ts`,
        graphql: 'npm:graphql@16',
      },
    }),
  )
}

Deno.test(
  'runGraphqlCheck (Layer 2, real subprocess): a real local resolver + a matching query produce ' +
    'zero failures, a real mismatched query produces one real, named schema failure',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)
      await writeFile(
        join(root, 'handlers', 'products.resolver.handler.ts'),
        `import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'

@Resolver({ prefix: 'products' })
export class ProductsResolver extends ZanixResolver {
  @Query({ output: 'String' })
  public hello() {
    return 'hi'
  }
}
`,
      )
      await writeFile(
        join(root, 'clients', 'products.client.ts'),
        `export const productsClient = {
  schemaApplication: 'main',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )
      await writeFile(
        join(root, 'gql', 'products.gql.ts'),
        `export const HELLO_QUERY = 'query { productsHello }'
export const BROKEN_QUERY = 'query { doesNotExist }'
`,
      )

      const result = await runGraphqlCheck(root, root)

      assertEquals(result.syntaxFailures, [])
      assertEquals(result.unmatchedApplications, [])
      assertEquals(result.schemaFailures.length, 1)
      assertEquals(result.schemaFailures[0].exportName, 'BROKEN_QUERY')
      assertEquals(result.schemaFailures[0].schemaApplication, 'main')
      assert(
        result.schemaFailures[0].errors.some((message) => message.includes('doesNotExist')),
        `expected the unknown field named in the error: ${
          JSON.stringify(result.schemaFailures[0].errors)
        }`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'runGraphqlCheck (Layer 2, real subprocess): a pure space project with no client/gql content at ' +
    'all never even spawns the subprocess — zero failures, zero warnings',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      // Deliberately NO deno.json at all — if the subprocess were ever spawned here, `@zanix/core`
      // would fail to resolve and this test would fail loudly instead of passing quietly, proving
      // the gate really did short-circuit before any subprocess ran.
      await writeFile(
        join(root, 'gql', 'users.gql.ts'),
        `export const GET_USER = 'query { user }'\n`,
      )

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

Deno.test(
  'runGraphqlCheck (Layer 2, real subprocess): a space project with defineBootstrapSpaceAppConfig({ ' +
    'server: { graphql } }) declared, but no auto-discovered resolver file, still discovers NOTHING ' +
    "— Zanix.compose(rootDir) never reads space.app.ts, so a space app's own runtime GraphQL " +
    'config is invisible to this static check, confirmed empirically, not assumed',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)
      // Present on disk, deliberately never imported by anything the subprocess reaches (it only
      // ever imports files matching `ZANIX_SERVER_MODULES`'s own suffixes) — included purely to
      // prove its mere presence changes nothing, not to exercise it.
      await writeFile(
        join(root, 'space.app.ts'),
        `// defineBootstrapSpaceAppConfig({ server: { graphql: {} } }) would go here in a real
// project — never imported by this scaffold's own deno.json (no @zanix/space entry), and never
// reached by Zanix.compose(rootDir) either way (see this file's own module doc).
`,
      )
      await writeFile(
        join(root, 'clients', 'products.client.ts'),
        `export const productsClient = {
  schemaApplication: 'main',
  query: () => Promise.resolve({ data: {} }),
  http: { post: () => Promise.resolve({}) },
}
`,
      )
      await writeFile(
        join(root, 'gql', 'products.gql.ts'),
        `export const HELLO_QUERY = 'query { hello }'\n`,
      )

      const result = await runGraphqlCheck(root, root)

      assertEquals(
        result,
        {
          syntaxFailures: [],
          schemaFailures: [],
          unmatchedApplications: [],
          missingExternalCaches: [],
        },
        'no .handler.ts/.interactor.ts/.connector.ts/.provider.ts/.defs.ts file registered any ' +
          'operation, so Zanix.compose found nothing to compile a schema from — the correct, ' +
          "honest outcome for this project, not a degraded one (see this module's own doc)",
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
