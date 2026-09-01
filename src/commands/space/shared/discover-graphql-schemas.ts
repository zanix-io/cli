import { resolve } from '@std/path'

/**
 * The script {@linkcode discoverGraphqlSchemas} writes into the target project and runs there via
 * `deno run` — never imported in-process by `cli` itself. Same reasoning as
 * `generate/openapi/discover.ts`'s own `DISCOVERY_SCRIPT`: a target project's decorator metadata
 * only accumulates inside a process that resolves that project's OWN module graph (its own
 * `@zanix/core`/`@zanix/server`/`graphql` versions, its own `deno.json`), never `cli`'s.
 *
 * Two preconditions are checked explicitly, each with its own sentinel line printed to stderr
 * before a non-zero exit, mirroring `discover.ts`'s own shape: the resolved `@zanix/core` may
 * predate `Zanix.compose`, and the resolved `@zanix/server/graphql` may predate
 * `defineSchema`/`getSchema`/`getSchemaApplications`. `@zanix/server/graphql` is imported as a
 * namespace (`import * as`), not a named `{ defineSchema, getSchema, getSchemaApplications }`
 * import, for the same reason `discover.ts` imports `@zanix/validator` that way: a named import of
 * an export the resolved module doesn't have yet fails at module-link time, before any of this
 * script's own code can run and print its own clear sentinel instead.
 *
 * `Zanix.compose(rootDir)` only ever registers the project's own auto-discovered handlers under
 * `@zanix/core`'s `DEFAULT_APPLICATION` (see that function's own doc, `@zanix/core`) — a named,
 * `apps`-scoped Application (`Zanix.start`'s own `apps` option) is never reachable this way, the
 * same structural limitation `discover.ts`'s own doc already states for REST routes. So
 * `getSchemaApplications()` below can, in practice, only ever return `[]` or `['main']` — never a
 * project-defined name. See `graphql-check.ts`'s own module doc for what that means for a client
 * whose `schemaApplication` names an `apps`-scoped Application.
 */
const DISCOVERY_SCRIPT = `
import Zanix from '@zanix/core'
import * as znxServerGraphql from '@zanix/server/graphql'
import { printSchema } from 'graphql'

const rootDir = Deno.args[0] || '.'

if (typeof Zanix.compose !== 'function') {
  console.error('ZANIX_COMPOSE_UNSUPPORTED')
  Deno.exit(1)
}

const { defineSchema, getSchema, getSchemaApplications } = znxServerGraphql

if (
  typeof getSchemaApplications !== 'function' ||
  typeof defineSchema !== 'function' ||
  typeof getSchema !== 'function'
) {
  console.error('ZANIX_GRAPHQL_SCHEMA_API_UNSUPPORTED')
  Deno.exit(1)
}

await Zanix.compose(rootDir)

const result = {}
for (const application of getSchemaApplications()) {
  defineSchema(application)
  const schema = getSchema(application)
  if (schema) result[application] = printSchema(schema)
}

console.log(JSON.stringify(result))
`

/** Every sentinel {@linkcode DISCOVERY_SCRIPT} can print to stderr, mapped to the clear, actionable
 * error {@linkcode discoverGraphqlSchemas} throws instead of surfacing the raw subprocess failure —
 * same shape as `discover.ts`'s own `SENTINEL_ERRORS`. */
const SENTINEL_ERRORS: Record<string, string> = {
  ZANIX_COMPOSE_UNSUPPORTED:
    "This project's @zanix/core version doesn't support Zanix.compose() (needed for the GraphQL " +
    'schema check) — upgrade @zanix/core.',
  ZANIX_GRAPHQL_SCHEMA_API_UNSUPPORTED:
    "This project's @zanix/server version doesn't expose defineSchema()/getSchema()/" +
    "getSchemaApplications() at its own './graphql' subpath (needed for the GraphQL schema " +
    'check) — upgrade @zanix/server.',
}

/**
 * Runs {@linkcode DISCOVERY_SCRIPT} inside a `deno run` subprocess rooted at `root` (the target
 * project), returning every locally compiled GraphQL schema this process found, printed to real
 * SDL text (`graphql-js`'s own `printSchema`) and keyed by Application name — `{}` when the
 * project registers no GraphQL operations at all (the normal case for a `space` project with no
 * local GraphQL server of its own; see `graphql-check.ts`'s own module doc).
 *
 * The script is written to a real temporary `.ts` file INSIDE `root`, never passed by path from
 * outside it — same reasoning `discoverRoutes` documents in full for why that matters to Deno's own
 * bare-specifier resolution. The temp file is removed in a `finally`, whether discovery succeeds or
 * fails.
 *
 * Called at most once per {@linkcode checkGraphqlSchemas} run, never once per client — booting a
 * real project (its own connectors/providers/handlers) is real work, not something worth paying for
 * twice in the same check.
 *
 * @param root - The target project's own root folder.
 * @param rootDir - Forwarded to `Zanix.compose` as its own handler-discovery scope — same option,
 * same default (`'.'`), as `discoverRoutes`'s own `rootDir` parameter.
 * @throws {Error} When either precondition above isn't met, or the subprocess fails for any other
 * reason (module resolution, a real error thrown while importing one of the project's own
 * decorated files) — the raw stderr is appended for diagnosis either way.
 */
export async function discoverGraphqlSchemas(
  root: string,
  rootDir?: string,
): Promise<Record<string, string>> {
  root = resolve(root)
  const scriptPath = await Deno.makeTempFile({ dir: root, suffix: '.ts' })

  try {
    await Deno.writeTextFile(scriptPath, DISCOVERY_SCRIPT)

    const command = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', '--min-dep-age', '0', scriptPath, rootDir ?? '.'],
      cwd: root,
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, stdout, stderr } = await command.output()
    const stderrText = new TextDecoder().decode(stderr)

    if (!success) {
      for (const [sentinel, message] of Object.entries(SENTINEL_ERRORS)) {
        if (stderrText.includes(sentinel)) throw new Error(message)
      }
      throw new Error(`GraphQL schema discovery failed:\n${stderrText}`)
    }

    const stdoutText = new TextDecoder().decode(stdout).trim()
    return stdoutText ? JSON.parse(stdoutText) : {}
  } finally {
    await Deno.remove(scriptPath).catch(() => {})
  }
}
