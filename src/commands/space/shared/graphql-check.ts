import type { DocumentNode, GraphQLSchema } from 'graphql'

import { resolve } from '@std/path'
import logger from '@zanix/utils/logger'
import {
  clientBaseName,
  collectFiles,
  discoverGraphqlClients,
  isCheckedExternalSchemaApplication,
  isExternalSchemaApplication,
} from 'commands/space/shared/discover-graphql-clients.ts'
import { importProjectModule } from 'commands/space/shared/import-project-module.ts'

/**
 * `gql/**\/*.gql.ts` → two-layer GraphQL check, the real implementation `GraphQLClient`'s own
 * `schemaApplication` field (`@zanix/server`) already documents as its eventual reader: "read only
 * by `zanix space build`'s GraphQL check step (`@zanix/cli`)".
 *
 * **Layer 1 — syntax, always, independent of any local server.** {@linkcode checkGraphqlSyntax}
 * `parse()`s (`graphql-js`, the real `npm:graphql` package — never reimplemented) every exported
 * string value in every `gql/**\/*.gql.ts` file under a project's `gql/` directory — both shapes
 * `@zanix/space`'s own `docs/data-fetching.md` documents (`gql/<domain>.gql.ts` a single file, or
 * `gql/<domain>/**\/*.gql.ts` once a domain outgrows one file) are handled uniformly, by walking the
 * whole `gql/` tree recursively rather than special-casing either shape.
 *
 * **Layer 2 — schema match, whenever SOME real schema is actually available.**
 * {@linkcode checkGraphqlSchemas} discovers every `**\/*.client.ts` export structurally shaped like a
 * `GraphQLClient` (never `instanceof` — see `discover-graphql-clients.ts`'s own
 * `looksLikeGraphqlClient` doc for why; that module's {@linkcode discoverGraphqlClients} is shared
 * with `zanix generate graphql-schema`, `commands/generate/graphql-schema/command.ts`, so both walk
 * the exact same client discovery instead of each keeping its own copy), and reads its
 * `schemaApplication` (`SchemaApplication`, `discover-graphql-clients.ts`) to pick one of three
 * paths:
 *
 * - A plain Application name (or `undefined`, the project's own default) — validates the matching
 *   `gql/<name>` content (matched by filename, stripping the `.client.ts` suffix) against a real,
 *   LOCALLY compiled schema, discovered via {@linkcode discoverGraphqlSchemas}
 *   (`discover-graphql-schemas.ts`): a real `deno run` subprocess, rooted at the project, that runs
 *   `Zanix.compose(rootDir)` — the same static-introspection technique `generate/openapi/discover.ts`
 *   already uses for REST routes — then reads back whatever GraphQL Applications that registered via
 *   `@zanix/server/graphql`'s `getSchemaApplications`/`defineSchema`/`getSchema`. Called once per
 *   check, never once per client (see that function's own doc for why).
 * - The plain string `'external'` — syntax-only, exactly as Layer 1 already covers; never matched
 *   against any schema, local or cached.
 * - The object form `{ external: true }` (`isCheckedExternalSchemaApplication`) — this client's
 *   real, EXTERNAL schema (never reachable via the local subprocess above) is validated against too,
 *   from a build-time CACHE: `gql/<name>.schema.graphql`, real SDL text `zanix generate
 *   graphql-schema` writes by actually calling `GraphQLClient.introspect()` against the client's own
 *   live endpoint. Missing that cache file is a {@linkcode GraphqlMissingExternalCache} warning
 *   (never a build failure — see {@linkcode reportGraphqlCheckWarnings}), suggesting the generator
 *   be run; a real schema mismatch, once the cache exists, is a normal
 *   {@linkcode GraphqlSchemaFailure} like any other.
 *
 * **Real, confirmed limitations that remain, not a bug in this module.** `Zanix.compose(rootDir)`
 * only ever registers a project's own auto-discovered handlers under `@zanix/core`'s
 * `DEFAULT_APPLICATION` — a named, `apps`-scoped Application is never reachable this way, and
 * `compose()`'s own doc is explicit about why this is deliberate, not an oversight: an `apps` entry
 * can declare real `dependencies` (a required slot would need a live DB/cache connector
 * constructed) and/or a real `onStart` hook, neither separable from route registration — activating
 * one here would break `compose()`'s "zero side effects, nothing to tear down" guarantee, trading a
 * fast, side-effect-free build-time check for one that can spin up real infrastructure (or hang on
 * it). The same structural limitation `discover.ts`'s own doc already states for REST routes. A
 * client whose `schemaApplication` names an unreachable one is reported as
 * {@linkcode GraphqlUnmatchedApplication} exactly like a genuine typo would be, whenever at least one
 * OTHER client resolves for real.
 *
 * This means two genuinely different situations both surface as "nothing found" here, and only one
 * of them is actually a no-op: a project truly has no local GraphQL server at all (nothing to
 * check, the correct outcome); OR a `space`/`space-server` project's OWN GraphQL server — reachable
 * only via `bootstrapRemoteApp`'s `apps`-scoped Application (plain `space`) or a spacecraft's own
 * `apps: {...}` entry (its space half) — genuinely exists but is invisible to this check for the
 * reason above. Neither case throws, warns, or reports a failure; `{}` comes back from
 * {@linkcode discoverGraphqlSchemas} either way, and the client is treated the same as
 * `schemaApplication: 'external'`. A `space`/`space-server` project that leans on
 * `defineBootstrapSpaceAppConfig({ server: { graphql: {...} } })` gets Layer 1 (syntax) but never
 * Layer 2 (schema match) for that server — worth knowing, not worth working around: see
 * `@zanix/cli`'s own `docs/new.md`, "Declaring `server: {...}` on a plain `space` doesn't make it a
 * spacecraft," for why that config is meant to stay small in the first place.
 *
 * Case B — a client's schema genuinely lives outside this project entirely — is NOT out of scope
 * for a client whose `schemaApplication` is the object form `{ external: true }`: see the third
 * bullet above. It stays exactly as much out of scope as before for the plain `'external'` string,
 * whose whole point is opting OUT of any schema match, local or cached.
 *
 * @module
 */

/** One `gql/**\/*.gql.ts` export whose value failed `graphql-js`'s own `parse()`. */
export interface GraphqlSyntaxFailure {
  file: string
  exportName: string
  error: Error
}

/** One query/mutation that failed `graphql-js`'s own `validate()` against a real, locally compiled
 * schema. */
export interface GraphqlSchemaFailure {
  file: string
  exportName: string
  clientFile: string
  schemaApplication: string
  errors: string[]
}

/** A client declared a `schemaApplication` that matches no Application with a locally compiled
 * schema in this project, while at least one OTHER local Application does — the real signal a typo
 * is worth surfacing for. Never emitted when no local Application has a compiled schema at all,
 * which would make this pure, permanent noise for a project with no local GraphQL server. */
export interface GraphqlUnmatchedApplication {
  clientFile: string
  schemaApplication: string
}

/** A client's `schemaApplication` is `{ external: true }` (opting in to Case B's real cache/validate
 * path), but `cachePath` — `gql/<name>.schema.graphql` — doesn't exist yet on disk. A warning, never
 * a build failure: the project owner hasn't run `zanix generate graphql-schema` yet (or ran it
 * before this client existed), not a broken project. See {@linkcode reportGraphqlCheckWarnings}. */
export interface GraphqlMissingExternalCache {
  clientFile: string
  cachePath: string
}

/** Everything {@linkcode runGraphqlCheck} found — facts, never a decision about what to do with
 * them. {@linkcode assertNoGraphqlCheckFailures}/{@linkcode reportGraphqlCheckFailures} decide that,
 * the same "report facts, let the caller decide" split `compile-messages.ts` already uses. */
export interface GraphqlCheckResult {
  syntaxFailures: GraphqlSyntaxFailure[]
  schemaFailures: GraphqlSchemaFailure[]
  unmatchedApplications: GraphqlUnmatchedApplication[]
  missingExternalCaches: GraphqlMissingExternalCache[]
}

/** Every exported string value of the module at `path` — the only shape {@linkcode
 * checkGraphqlSyntax} looks at; anything else exported (a function, a class, an object) is silently
 * ignored, the same "only string values" scope `compile-messages.ts`'s own catalogs already keep.
 * Imported via `importProjectModule` (`import-project-module.ts`) — `path` belongs to a consuming
 * project, not to `@zanix/cli`, and its own bare specifiers (a shared fragment pulled in from
 * elsewhere in the project, for instance) must resolve against ITS nearest `deno.json(c)`. */
async function readModuleStrings(path: string): Promise<Record<string, string>> {
  const mod = await importProjectModule(resolve(path))
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(mod)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

/** {@linkcode checkGraphqlSyntax}'s own return shape. `parsed` is keyed by file path, then export
 * name, and reused directly by {@linkcode checkGraphqlSchemas} — a query already known to be
 * syntactically broken is never re-parsed, and never reaches `validate()` a second time. */
export interface GraphqlSyntaxCheckResult {
  failures: GraphqlSyntaxFailure[]
  parsed: Map<string, Map<string, DocumentNode>>
}

/**
 * Layer 1 — parses every exported string in every `gql/**\/*.gql.ts` file under `gqlDir` with
 * `graphql-js`'s own `parse()`. Isolated across files and exports, the same "one broken query never
 * hides the rest" default `compileMessagesTree` already uses for message catalogs — every
 * file/export is attempted independently, so one run surfaces every syntax problem in the tree at
 * once.
 *
 * @param gqlDir - A project's `gql/` directory, already resolved to an absolute path.
 */
export async function checkGraphqlSyntax(gqlDir: string): Promise<GraphqlSyntaxCheckResult> {
  const files = await collectFiles(gqlDir, '.gql.ts')
  const failures: GraphqlSyntaxFailure[] = []
  const parsed = new Map<string, Map<string, DocumentNode>>()
  // Lazy on purpose — a project with a `gql/` dir but zero `.gql.ts` files (unusual, but possible
  // mid-refactor) never pays for loading `graphql-js` at all.
  if (files.length === 0) return { failures, parsed }

  const { parse } = await import('graphql')

  await Promise.all(files.map(async (file) => {
    let exports: Record<string, string>
    try {
      exports = await readModuleStrings(file)
    } catch (error) {
      failures.push({
        file,
        exportName: '(module)',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return
    }

    const fileParsed = new Map<string, DocumentNode>()
    for (const [exportName, text] of Object.entries(exports)) {
      try {
        fileParsed.set(exportName, parse(text))
      } catch (error) {
        failures.push({
          file,
          exportName,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
    if (fileParsed.size > 0) parsed.set(file, fileParsed)
  }))

  return { failures, parsed }
}

/** Every parsed query belonging to `baseName`'s matching `gql/<baseName>.gql.ts` file OR
 * `gql/<baseName>/**\/*.gql.ts` folder — reusing {@linkcode checkGraphqlSyntax}'s own `parsed` map,
 * which already covers both shapes uniformly, so a query already known to be syntactically broken
 * is never handed to `validate()`. */
function matchGqlContent(
  gqlDir: string,
  baseName: string,
  parsed: Map<string, Map<string, DocumentNode>>,
): Map<string, Map<string, DocumentNode>> {
  const filePath = `${gqlDir}/${baseName}.gql.ts`
  const folderPrefix = `${gqlDir}/${baseName}/`
  const matched = new Map<string, Map<string, DocumentNode>>()
  for (const [file, queries] of parsed) {
    if (file === filePath || file.startsWith(folderPrefix)) matched.set(file, queries)
  }
  return matched
}

/** Mirrors `@zanix/server`'s own `DEFAULT_APPLICATION` (`modules/program/metadata/application.ts`)
 * — not reachable from `@zanix/server/graphql`'s own narrower subpath, which is the only one this
 * module ever imports (see `deno-lazy-dependency-pattern`) — so this is the same fixed literal
 * value, verified against that source, not a live import of it. */
const DEFAULT_GRAPHQL_APPLICATION = 'main'

/** The build-time cache path Case B reads/writes for `baseName` — `zanix generate graphql-schema`'s
 * own output convention, matched here identically so neither side derives it two different ways. */
function externalCachePath(gqlDir: string, baseName: string): string {
  return `${gqlDir}/${baseName}.schema.graphql`
}

/**
 * Layer 2 — discovers every `GraphQLClient`-shaped export under `root`, matches each to its `gql/`
 * content, and validates against a real schema when one is actually available — a LOCALLY compiled
 * one for a plain/default `schemaApplication`, or a CACHED external one
 * (`gql/<name>.schema.graphql`) for the `{ external: true }` form — see this module's own doc for
 * exactly how each is discovered and the real limitations that remain.
 *
 * @param root - The whole project root — client files are not confined to `gql/`'s own parent
 * directory (a `space-server` project's clients may live under `src/server/` too). Also the root
 * {@linkcode discoverGraphqlSchemas}'s own subprocess is rooted at.
 * @param gqlDir - The same `gql/` directory `parsed` was compiled from.
 * @param parsed - {@linkcode checkGraphqlSyntax}'s own `parsed` map for this same run.
 */
export async function checkGraphqlSchemas(
  root: string,
  gqlDir: string,
  parsed: Map<string, Map<string, DocumentNode>>,
): Promise<
  Pick<GraphqlCheckResult, 'schemaFailures' | 'unmatchedApplications' | 'missingExternalCaches'>
> {
  const schemaFailures: GraphqlSchemaFailure[] = []
  const unmatchedApplications: GraphqlUnmatchedApplication[] = []
  const missingExternalCaches: GraphqlMissingExternalCache[] = []

  const clients = await discoverGraphqlClients(root)
  const checkedExternal = clients.filter((client) =>
    isCheckedExternalSchemaApplication(client.schemaApplication)
  )
  // Excludes BOTH external forms (plain `'external'` stays syntax-only, `{ external: true }` is
  // handled separately, right below) — everything left has a plain Application name, or `undefined`
  // for the project's own default.
  const nonExternal = clients.filter((client) =>
    !isExternalSchemaApplication(client.schemaApplication)
  )

  if (nonExternal.length === 0 && checkedExternal.length === 0) {
    return { schemaFailures, unmatchedApplications, missingExternalCaches }
  }

  const { validate, buildSchema } = await import('graphql')

  // Case B's own cache-match path — independent of the local-subprocess path below, and resolved
  // first: a project can have checked-external clients with no local GraphQL server at all. Each
  // client's own cache read is independent of every other's, the same "attempted in parallel,
  // never one slow/missing file stalling the rest" shape `checkGraphqlSyntax` already uses.
  await Promise.all(checkedExternal.map(async (client) => {
    const baseName = clientBaseName(client.file)
    const cachePath = externalCachePath(gqlDir, baseName)

    let cachedSdl: string
    try {
      cachedSdl = await Deno.readTextFile(cachePath)
    } catch {
      missingExternalCaches.push({ clientFile: client.file, cachePath })
      return
    }

    const matched = matchGqlContent(gqlDir, baseName, parsed)
    if (matched.size === 0) return

    const schema = buildSchema(cachedSdl)
    for (const [file, queries] of matched) {
      for (const [exportName, document] of queries) {
        const errors = validate(schema, document)
        if (errors.length === 0) continue
        schemaFailures.push({
          file,
          exportName,
          clientFile: client.file,
          schemaApplication: 'external',
          errors: errors.map((error) => error.message),
        })
      }
    }
  }))

  if (nonExternal.length === 0) {
    return { schemaFailures, unmatchedApplications, missingExternalCaches }
  }

  const { discoverGraphqlSchemas } = await import(
    'commands/space/shared/discover-graphql-schemas.ts'
  )

  // Called once for the WHOLE check, never once per client — booting a real project is real work.
  // Keyed by Application name, SDL text (`printSchema`'s own output) rebuilt locally via
  // `buildSchema` — the live `GraphQLSchema` object itself never crosses the subprocess boundary.
  const discovered = await discoverGraphqlSchemas(root)
  const compiledSchemas = new Map<string, GraphQLSchema>(
    Object.entries(discovered).map(([application, sdl]) => [application, buildSchema(sdl)]),
  )

  // Resolved once per client, up front — every non-external client is matched against
  // `compiledSchemas`, regardless of whether it has any matching `gql/` content, specifically so
  // `hasAnyResolved` below reflects the WHOLE project's own local Applications, not just the
  // subset that happens to have matching query text. `schemaApplication` is safely narrowed to a
  // plain Application name (or `undefined`) here — `nonExternal` above already excluded both forms
  // `SchemaApplication` otherwise allows.
  const resolved = nonExternal.map((client) => ({
    client,
    applicationName: client.schemaApplication as string | undefined,
  })).map(({ client, applicationName }) => ({
    client,
    applicationName,
    schema: compiledSchemas.get(applicationName ?? DEFAULT_GRAPHQL_APPLICATION),
  }))
  const hasAnyResolved = resolved.some((entry) => entry.schema !== undefined)

  for (const { client, applicationName, schema } of resolved) {
    const matched = matchGqlContent(gqlDir, clientBaseName(client.file), parsed)

    if (!schema) {
      if (applicationName !== undefined && hasAnyResolved) {
        unmatchedApplications.push({
          clientFile: client.file,
          schemaApplication: applicationName,
        })
      }
      continue
    }
    if (matched.size === 0) continue

    for (const [file, queries] of matched) {
      for (const [exportName, document] of queries) {
        const errors = validate(schema, document)
        if (errors.length === 0) continue
        schemaFailures.push({
          file,
          exportName,
          clientFile: client.file,
          schemaApplication: applicationName ?? '(default)',
          errors: errors.map((error) => error.message),
        })
      }
    }
  }

  return { schemaFailures, unmatchedApplications, missingExternalCaches }
}

/**
 * Runs both layers for the project rooted at `root`, whose Space half's `gql/` directory is
 * `${spaceRoot}/gql`. A no-op — nothing walked, nothing imported — when that directory does not
 * exist, matching `messagesDir`'s own "opt-out only means something when the feature is actually
 * configured" shape.
 *
 * @param root - The whole project root (`Deno.cwd()` for `zanix space build`/`zanix space dev`).
 * @param spaceRoot - The Space half's own root — the same directory `routesDir`/`comets`/`clients`
 * already live under (derived from `getRoutesDir()`'s own parent by every caller of this function).
 */
export async function runGraphqlCheck(
  root: string,
  spaceRoot: string,
): Promise<GraphqlCheckResult> {
  const gqlDir = `${spaceRoot}/gql`
  const gqlDirExists = await Deno.stat(gqlDir).then((stat) => stat.isDirectory).catch(() => false)
  if (!gqlDirExists) {
    return {
      syntaxFailures: [],
      schemaFailures: [],
      unmatchedApplications: [],
      missingExternalCaches: [],
    }
  }

  const syntax = await checkGraphqlSyntax(gqlDir)
  const { schemaFailures, unmatchedApplications, missingExternalCaches } =
    await checkGraphqlSchemas(
      root,
      gqlDir,
      syntax.parsed,
    )

  return {
    syntaxFailures: syntax.failures,
    schemaFailures,
    unmatchedApplications,
    missingExternalCaches,
  }
}

function formatFailureLines(result: GraphqlCheckResult): string[] {
  const lines: string[] = []
  for (const failure of result.syntaxFailures) {
    lines.push(`${failure.file} (${failure.exportName}): ${failure.error.message}`)
  }
  for (const failure of result.schemaFailures) {
    lines.push(
      `${failure.file} (${failure.exportName}), against '${failure.schemaApplication}': ` +
        failure.errors.join('; '),
    )
  }
  return lines
}

/**
 * Turns a non-empty `result.syntaxFailures`/`result.schemaFailures` into one aggregate, thrown
 * `Error` naming every broken export/query — the one-call hook `zanix space build` uses to turn
 * "some queries failed" into a hard build failure, without hand-rolling the aggregation itself. The
 * same "report facts, decide separately" split `assertNoCompileFailures` already uses for
 * message catalogs. A no-op when both arrays are empty — `result.unmatchedApplications` never fails
 * a build on its own, see {@linkcode reportGraphqlCheckFailures}.
 */
export function assertNoGraphqlCheckFailures(result: GraphqlCheckResult): void {
  const lines = formatFailureLines(result)
  if (lines.length === 0) return
  throw new Error(
    `${lines.length} GraphQL query/mutation issue(s) found:\n${
      lines.map((line) => `  - ${line}`).join('\n')
    }`,
  )
}

/**
 * Logs every syntax/schema failure as a single grouped `logger.error`, never throwing — the `zanix
 * space dev` counterpart to {@linkcode assertNoGraphqlCheckFailures}: a broken query is worth
 * surfacing loudly, but dev mode keeps running regardless, the same "report, never crash the dev
 * server" shape document validation already follows there.
 *
 * @returns `true` when at least one failure was reported, so a caller can decide what that means
 * for it (this function itself never fails/exits).
 */
export function reportGraphqlCheckFailures(result: GraphqlCheckResult): boolean {
  const lines = formatFailureLines(result)
  if (lines.length === 0) return false
  logger.error(
    `GraphQL check: ${lines.length} issue(s)\n${lines.map((line) => `- ${line}`).join('\n\n')}`,
    'noSave',
  )
  return true
}

/**
 * Logs every `result.unmatchedApplications`/`result.missingExternalCaches` entry as its own grouped
 * `logger.warn` — never thrown, never fails a build/dev run either way. Shared between `zanix space
 * build` and `zanix space dev`, same as {@linkcode reportGraphqlCheckFailures}.
 */
export function reportGraphqlCheckWarnings(result: GraphqlCheckResult): void {
  if (result.unmatchedApplications.length > 0) {
    const body = result.unmatchedApplications.map((warning) =>
      `- ${warning.clientFile}: schemaApplication '${warning.schemaApplication}' matches no local ` +
      'GraphQL Application with a compiled schema in this project — verify the name, or set ' +
      "schemaApplication: 'external' if this client genuinely talks to a schema outside this project."
    ).join('\n\n')
    logger.warn(
      `GraphQL check: ${result.unmatchedApplications.length} unmatched schemaApplication(s)\n${body}`,
      'noSave',
    )
  }

  if (result.missingExternalCaches.length > 0) {
    const body = result.missingExternalCaches.map((warning) =>
      `- ${warning.clientFile}: schemaApplication is { external: true }, but its cache ` +
      `'${warning.cachePath}' doesn't exist yet — run 'zanix generate graphql-schema' to introspect ` +
      "and cache this client's real, external schema."
    ).join('\n\n')
    logger.warn(
      `GraphQL check: ${result.missingExternalCaches.length} missing external schema cache(s)\n${body}`,
      'noSave',
    )
  }
}
