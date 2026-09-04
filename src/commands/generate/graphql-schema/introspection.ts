/**
 * Turns a `GraphQLClient.introspect()`'s raw JSON result (`@zanix/server`'s own connector — see
 * that method's own doc for why it returns raw JSON, never a `graphql-js` `GraphQLSchema`) into
 * real SDL text, via `graphql-js`'s own `buildClientSchema()` + `printSchema()`.
 *
 * `graphql` (`npm:graphql`) is imported dynamically, INSIDE this function, never as a static
 * top-level import — same lazy-loading discipline `commands/space/shared/graphql-check.ts` already
 * applies to the same package: a `zanix` invocation with no external, introspectable GraphQL
 * client never pays for loading `graphql-js` at all.
 *
 * @param raw - The exact `Record<string, unknown>` `GraphQLClient.introspect()` resolves with
 * (typically `{ __schema: {...} }}`, per the GraphQL spec's own introspection response shape).
 * @returns Real, printable SDL text — the same string `graphql-js`'s own `printSchema()` produces
 * for any other `GraphQLSchema`.
 */
export async function introspectionToSdl(raw: Record<string, unknown>): Promise<string> {
  const { buildClientSchema, printSchema } = await import('graphql')
  // `raw` is genuinely untyped here — it's whatever a live, external endpoint answered with, never
  // guaranteed at compile time to carry `__schema` — so this goes through `unknown` first rather
  // than a direct cast, the same "acknowledge this isn't actually checked" signal a direct
  // `Record<string, unknown>` → `IntrospectionQuery` cast would otherwise hide.
  const schema = buildClientSchema(raw as unknown as Parameters<typeof buildClientSchema>[0])
  return printSchema(schema)
}
