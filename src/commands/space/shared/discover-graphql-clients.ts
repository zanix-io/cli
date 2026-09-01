import { basename, resolve } from '@std/path'
import { importProjectModule } from 'commands/space/shared/import-project-module.ts'

/**
 * Structural discovery of every real `GraphQLClient`-shaped export under a project root — factored
 * out of `graphql-check.ts` (Layer 2's own discovery step) so `zanix generate graphql-schema`
 * (`commands/generate/graphql-schema/command.ts`) can reuse the exact same discovery logic instead
 * of hand-rolling its own copy. Neither caller ever imports `@zanix/server`'s real `GraphQLClient`
 * as a VALUE — see {@linkcode looksLikeGraphqlClient}'s own doc for why a structural check is used
 * instead of `instanceof`.
 *
 * @module
 */

/** Directory names never walked while discovering `**\/*.client.ts` files across a whole project —
 * none of these can plausibly hold a real, project-authored client. */
export const EXCLUDED_CLIENT_DIRS = new Set([
  'node_modules',
  '.git',
  '.dist',
  'coverage',
  '__tmp__',
])

/** Recursively collects every file under `dir` whose name ends with `suffix`, skipping any
 * directory named in `exclude`. A missing `dir` resolves to `[]`, never a thrown error — the normal
 * case for a project with no `gql/`/client folder at all. */
export async function collectFiles(
  dir: string,
  suffix: string,
  exclude?: Set<string>,
): Promise<string[]> {
  let entries: Deno.DirEntry[]
  try {
    entries = await Array.fromAsync(Deno.readDir(dir))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return []
    throw error
  }

  const files: string[] = []
  const subdirs: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      if (exclude?.has(entry.name)) continue
      subdirs.push(`${dir}/${entry.name}`)
    } else if (entry.isFile && entry.name.endsWith(suffix)) {
      files.push(`${dir}/${entry.name}`)
    }
  }
  const nested = await Promise.all(subdirs.map((sub) => collectFiles(sub, suffix, exclude)))
  return [...files, ...nested.flat()]
}

/**
 * The three shapes `GqlClientOptions.schemaApplication` (`@zanix/server`) can take — modeled here as
 * this module's OWN structural type, never imported live from `@zanix/server` (same reasoning as
 * {@linkcode looksLikeGraphqlClient} itself, see its own doc): a plain Application name; the literal
 * `'external'`, meaning "talks to a schema outside this project, syntax-checked only"; or
 * `{ external: true }`, the same "external" meaning PLUS an opt-in to also cache/validate that
 * external schema for real (`zanix generate graphql-schema`, Layer 2's own cache-match path) — the
 * object shape itself IS the opt-in, no separate boolean field alongside it. Use
 * {@linkcode isExternalSchemaApplication}/{@linkcode isCheckedExternalSchemaApplication} to read
 * this rather than comparing shapes inline.
 */
export type SchemaApplication = string | 'external' | { external: true }

/** Structural shape a real `GraphQLClient` subclass instance satisfies — `.query` (the method every
 * subclass calls to send a request) plus `.http.post` (its `RestClient` base's own transport). The
 * index signature is deliberate: callers read whatever OTHER build-time-only marker
 * `GqlClientOptions` carries directly off the live instance, without this module needing its own
 * copy of every such field's name/type. */
export interface GraphqlClientLike {
  query: unknown
  http: { post: unknown }
  schemaApplication?: SchemaApplication
  [key: string]: unknown
}

/** Whether `schemaApplication` marks a client as talking to a schema outside this project's own
 * composition — true for BOTH the plain `'external'` string and the `{ external: true }` object
 * form, since either way the client is never matched against a LOCALLY compiled schema (Layer 2's
 * `discoverGraphqlSchemas` subprocess). Distinguishing which of the two applies (syntax-only vs.
 * also cached/validated for real) is {@linkcode isCheckedExternalSchemaApplication}'s own job. */
export function isExternalSchemaApplication(schemaApplication: unknown): boolean {
  return schemaApplication === 'external' || isCheckedExternalSchemaApplication(schemaApplication)
}

/** Whether `schemaApplication` is specifically the `{ external: true }` object form — the real,
 * build-time-only opt-in telling `zanix generate graphql-schema`/Layer 2 to also introspect
 * (`GraphQLClient.introspect()`) and cache/validate this client's real, external schema, instead of
 * treating it as syntax-only like the plain `'external'` string. Deliberately structural (never a
 * live `@zanix/server` type import), the same duck-typing discipline
 * {@linkcode looksLikeGraphqlClient} already uses for the client instance itself. */
export function isCheckedExternalSchemaApplication(
  schemaApplication: unknown,
): schemaApplication is { external: true } {
  return typeof schemaApplication === 'object' && schemaApplication !== null &&
    (schemaApplication as Record<string, unknown>).external === true
}

/**
 * Whether `value` is shaped like a real `GraphQLClient` instance — deliberately structural, never
 * `instanceof GraphQLClient`.
 *
 * Not because `instanceof` is known to be unsafe here: a `*.client.ts` file is imported dynamically,
 * by absolute file path, from THIS process, via `importProjectModule` (`import-project-module.ts`)
 * — the same mechanism `importSpaceApp` uses for `space.app.ts` — with its own bare specifiers
 * (including `@zanix/server` itself) resolved against the TARGET PROJECT's own `deno.json(c)`, not
 * `@zanix/cli`'s. Whether a value import of `GraphQLClient` here and the one resolved inside the
 * imported file end up as the exact same module instance depends on how that file's own bare
 * `@zanix/server` specifier resolves — usually the same real package, but not a guarantee this
 * module needs to depend on. A structural check is used instead, deliberately, so this never needs
 * `GraphQLClient` as a VALUE import of its own at all — `.query`/`.http.post` together are specific
 * enough that nothing else in a real project plausibly matches them by accident.
 */
export function looksLikeGraphqlClient(value: unknown): value is GraphqlClientLike {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.query !== 'function') return false
  const http = candidate.http
  return typeof http === 'object' && http !== null &&
    typeof (http as Record<string, unknown>).post === 'function'
}

/** One `**\/*.client.ts` export {@linkcode discoverGraphqlClients} found, structurally shaped like a
 * `GraphQLClient`. `instance` is the real, live object — every caller reads whatever field it
 * actually needs straight off it. */
export interface DiscoveredGraphqlClient {
  file: string
  exportName: string
  schemaApplication: SchemaApplication | undefined
  instance: GraphqlClientLike
}

/** Every `**\/*.client.ts` export shaped like a `GraphQLClient`, discovered by importing each file
 * found under `root` (excluding {@linkcode EXCLUDED_CLIENT_DIRS}). A file that fails to import is
 * skipped, never a check failure of its own — an unimportable module is a real problem, but a
 * different one than a GraphQL-specific caller's own job; `zanix space build`'s own asset/SSR
 * pipeline (or `deno check`) already surfaces it on its own terms, and treating it as a GraphQL
 * failure here would just be a confusing second report of the same root cause. */
export async function discoverGraphqlClients(root: string): Promise<DiscoveredGraphqlClient[]> {
  const files = await collectFiles(root, '.client.ts', EXCLUDED_CLIENT_DIRS)

  const perFile = await Promise.all(files.map(async (file) => {
    let mod: Record<string, unknown>
    try {
      mod = await importProjectModule(resolve(file))
    } catch {
      return []
    }
    const fileDiscovered: DiscoveredGraphqlClient[] = []
    for (const [exportName, value] of Object.entries(mod)) {
      if (!looksLikeGraphqlClient(value)) continue
      fileDiscovered.push({
        file,
        exportName,
        schemaApplication: value.schemaApplication,
        instance: value,
      })
    }
    return fileDiscovered
  }))

  return perFile.flat()
}

/** The base name {@linkcode discoverGraphqlClients}'s own `file` maps to a `gql/` artifact by —
 * `<name>.client.ts` → `<name>` — reused identically by `graphql-check.ts`'s own `gql/<name>.gql.ts`
 * match and `zanix generate graphql-schema`'s own `gql/<name>.schema.graphql` cache file name, so
 * the two never derive that name two different ways. */
export function clientBaseName(file: string): string {
  return basename(file).replace(/\.client\.ts$/, '')
}
