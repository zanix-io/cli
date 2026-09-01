/**
 * One stacked decorator's own identity within a field's {@linkcode DiscoveredRtoFieldMetadata.decorators}
 * list — the JSON shape of `@zanix/utils`'s own `RTOFieldDecoratorEntry`, minus the field-wide
 * `each`/`optional`/`expose` flags that apply to the property as a whole rather than to a single
 * decorator in its stack.
 */
export type DiscoveredRtoFieldDecoratorEntry = {
  decorator?: string
  args: unknown[]
}

/**
 * Static field metadata for one `BaseRTO` field, as `discover.ts`'s subprocess serializes it —
 * the JSON shape of `@zanix/utils`'s own `RTOFieldMetadata` (`decorator`/`args`/`decorators`/`each`/
 * `optional`/`expose`), captured here as this module's OWN type rather than importing the live one
 * from `@zanix/validator`: nothing in this file ever touches a real RTO class, `Symbol.metadata`, or
 * `@zanix/utils` at all — only the plain data `discover.ts` already resolved in its own subprocess.
 *
 * A `ValidateNested` entry's `args[0]` is already-resolved plain field metadata (a
 * {@linkcode DiscoveredRtoFields}) for the nested RTO, not a live class constructor —
 * `discover.ts`'s own subprocess resolves it recursively before this type's shape ever crosses the
 * `JSON.parse` boundary back into `cli`'s own process.
 */
export type DiscoveredRtoFieldMetadata = {
  decorator?: string
  args: unknown[]
  /** Every decorator stacked on this field, in registration order — present only when two or more
   * decorators apply to the same property (e.g. `@IsString() @Length({ min: 1, max: 100 })`).
   * Absent for a single-decorator field, whose `decorator`/`args` above already describe it fully. */
  decorators?: DiscoveredRtoFieldDecoratorEntry[]
  each: boolean
  optional: boolean
  expose: boolean
}

/** One RTO's full field registry, keyed by field name — `classMetadata(SomeRTO)`'s own return shape. */
export type DiscoveredRtoFields = Record<string, DiscoveredRtoFieldMetadata>

/** The `Body`/`Params`/`Search` RTOs a route declared, each already resolved to plain field
 * metadata — mirrors `@zanix/types`' `RtoTypes`, minus the live class constructors. */
export type DiscoveredRouteRto = {
  Body?: DiscoveredRtoFields
  Params?: DiscoveredRtoFields
  Search?: DiscoveredRtoFields
}

/** One REST route as `discover.ts` reports it — the serializable subset of `@zanix/server`'s own
 * `RestRouteEntry`, plus already-resolved `rto` field metadata instead of live class constructors. */
export type DiscoveredRoute = {
  httpMethod: string
  path: string
  application: string
  rto?: DiscoveredRouteRto
}

/** A minimal JSON Schema (OpenAPI 3's own schema dialect) — only the shapes this generator's
 * decorator→schema mapping ever produces, not the full spec. `'object'`/`properties`/`required` is
 * a `ValidateNested` field's own nested schema, built by recursing {@linkcode fieldsToObjectSchema} —
 * structurally the same shape {@linkcode OpenapiObjectSchema} describes for a `Body` RTO's own
 * top-level schema. `minLength`/`maxLength` are `Length`'s own stacked contribution (see
 * {@linkcode baseFieldSchema}), merged onto whichever base type another stacked decorator
 * (`IsString`) contributed, never overwriting it. */
export type JsonSchema = {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  items?: JsonSchema
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  minLength?: number
  maxLength?: number
}

/** One path or query parameter, derived from a `Params`/`Search` RTO field. */
export type OpenapiParameter = {
  name: string
  in: 'path' | 'query'
  required: boolean
  schema: JsonSchema
}

/** A JSON-object schema built from a `Body` RTO's own exposed fields. */
export type OpenapiObjectSchema = {
  type: 'object'
  properties: Record<string, JsonSchema>
  required?: string[]
}

/** The JSON request body OpenAPI expects for a route whose `Body` RTO is declared — always
 * `required: true` and `application/json`, matching how `@zanix/server` itself parses one. */
export type OpenapiRequestBody = {
  required: boolean
  content: {
    'application/json': { schema: OpenapiObjectSchema }
  }
}

/** One HTTP method's own entry under a `paths` entry — one route, tagged with its Application. */
export type OpenapiOperation = {
  operationId: string
  tags: string[]
  parameters?: OpenapiParameter[]
  requestBody?: OpenapiRequestBody
  responses: { '200': { description: string } }
}

/** One `paths` entry — every HTTP method registered for that path, keyed lowercase per OpenAPI's
 * own convention (`@zanix/server`'s own `HttpMethod` is uppercase; this is the rendered form). */
export type OpenapiPathItem = Partial<
  Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head', OpenapiOperation>
>

/** The full document {@linkcode planOpenapiSpec} returns — what `openapi.json` serializes to. */
export type OpenapiSpec = {
  openapi: '3.0.3'
  info: { title: string; version: string }
  paths: Record<string, OpenapiPathItem>
}

/**
 * Normalizes `IsEnum`'s own first `args` entry (an array of literal values, or an enum-like object —
 * see `@zanix/validator`'s real `IsEnum(validations, options)` signature) down to a plain array of
 * allowed values, for `JsonSchema.enum`. Anything else (missing/malformed) yields an empty list — an
 * honest "no known members" rather than a guess.
 */
function normalizeEnumValues(arg: unknown): unknown[] {
  if (Array.isArray(arg)) return arg
  if (arg && typeof arg === 'object') return Object.values(arg as Record<string, unknown>)
  return []
}

/**
 * Every decorator stacked on a field, normalized to one shape regardless of how many the real
 * field actually stacked: a single-decorator field (no {@linkcode DiscoveredRtoFieldMetadata.decorators})
 * is reported as a one-entry list of its own `decorator`/`args`, so every consumer below reads the
 * stack uniformly instead of special-casing the single-decorator case separately.
 */
function decoratorEntries(
  field: Pick<DiscoveredRtoFieldMetadata, 'decorator' | 'args' | 'decorators'>,
): DiscoveredRtoFieldDecoratorEntry[] {
  return field.decorators ?? [{ decorator: field.decorator, args: field.args }]
}

/** The already-resolved nested field metadata a stacked `ValidateNested` entry carries, if any —
 * `undefined` when no entry in `entries` is `ValidateNested`. See
 * {@linkcode DiscoveredRtoFieldMetadata}'s own doc for why `args[0]` is safe to read directly here
 * (already plain metadata, never a live class constructor, by the time this runs). */
function nestedFieldsOf(
  entries: DiscoveredRtoFieldDecoratorEntry[],
): DiscoveredRtoFields | undefined {
  return entries.find((entry) => entry.decorator === 'ValidateNested')?.args[0] as
    | DiscoveredRtoFields
    | undefined
}

/**
 * Maps one stacked decorator entry's own contribution onto a JSON Schema fragment, merged (never
 * overwritten) onto the field's combined schema by {@linkcode baseFieldSchema} — this is what lets
 * `@IsString() @Length({ min: 1, max: 100 })` contribute `type: 'string'` and `minLength`/
 * `maxLength` onto the SAME schema object instead of the last-registered decorator winning alone.
 * An entry whose decorator contributes no known JSON Schema constraint (a custom/unrecognized
 * decorator, or `IsArray`/`ValidateNested` — both handled by their own dedicated callers instead)
 * contributes nothing here.
 */
function decoratorContribution(entry: DiscoveredRtoFieldDecoratorEntry): JsonSchema {
  switch (entry.decorator) {
    case 'IsString':
      return { type: 'string' }
    case 'IsNumber':
      return { type: 'number' }
    case 'IsBoolean':
      return { type: 'boolean' }
    case 'IsEnum':
      return { type: 'string', enum: normalizeEnumValues(entry.args[0]) }
    case 'Length': {
      // `Length`'s own `args[0]` is always `{ min, max }` (verified against `@zanix/utils`'s real
      // `strings/length.ts`), defaulting to `{ min: 0, max: Infinity }` when a caller only
      // constrains one side — neither default is a real constraint worth rendering.
      const { min, max } = (entry.args[0] as { min?: number; max?: number } | undefined) ?? {}
      const schema: JsonSchema = {}
      if (typeof min === 'number' && min > 0) schema.minLength = min
      if (typeof max === 'number' && Number.isFinite(max)) schema.maxLength = max
      return schema
    }
    default:
      return {}
  }
}

/**
 * Maps one field's own decorator stack (ignoring `each`) to its base JSON Schema — the piece
 * {@linkcode fieldToSchema} wraps in `{ type: 'array', items }` when the field validates each item
 * of an array instead of the whole value.
 *
 * A `ValidateNested` field (found anywhere in {@linkcode decoratorEntries}, not just as the
 * field-wide `decorator`, since it may be stacked alongside another decorator) resolves to a real
 * nested `type: 'object'` schema via {@linkcode fieldsToObjectSchema}, recursed over its own
 * already-resolved fields — `{ type: 'object', properties: {} }` only when discovery couldn't
 * resolve the nested class at all. Every other field merges every stacked decorator's own
 * {@linkcode decoratorContribution} onto one schema object; an unrecognized or missing `decorator`
 * (a custom decorator with no known name, or `IsArray` itself — see that function's own doc)
 * contributes nothing, leaving an honest empty schema rather than a guessed type.
 */
function baseFieldSchema(
  field: Pick<DiscoveredRtoFieldMetadata, 'decorator' | 'args' | 'decorators'>,
): JsonSchema {
  const entries = decoratorEntries(field)

  if (entries.some((entry) => entry.decorator === 'ValidateNested')) {
    const nested = nestedFieldsOf(entries)
    return nested ? fieldsToObjectSchema(nested) : { type: 'object', properties: {} }
  }

  return entries.reduce<JsonSchema>(
    (schema, entry) => ({ ...schema, ...decoratorContribution(entry) }),
    {},
  )
}

/**
 * Maps one `RTOFieldMetadata`-shaped field to its full JSON Schema, `IsArray` and `ValidateNested`
 * (with `each: true`) both included.
 *
 * `IsArray`'s own `RTOFieldMetadata` never carries a separate per-item decorator — `args` is
 * always empty (verified against `@zanix/utils`'s real `is-array.ts`: an array-of-scalars field is
 * declared `@IsArray({ each: true })`, with no second decorator recording what each item validates
 * against). The "recursed base schema" `items` gets is therefore {@linkcode baseFieldSchema} called
 * with no decorator at all — the same honest `{}` fallback every other unrecognized case uses, not
 * a guessed scalar type.
 *
 * `ValidateNested` uses the field's own generic `each` flag instead (`@ValidateNested(RTO, { each:
 * true })` — verified against `@zanix/utils`'s real `nested.ts` and its own RTO fixtures; there is
 * no separate "array of nested" decorator the way `IsArray` is its own decorator for scalars), so
 * an array-of-nested field wraps {@linkcode baseFieldSchema}'s own resolved nested object schema in
 * `{ type: 'array', items }` rather than falling through `IsArray`'s branch above.
 */
export function fieldToSchema(field: DiscoveredRtoFieldMetadata): JsonSchema {
  if (field.decorator === 'IsArray') {
    return { type: 'array', items: baseFieldSchema({ decorator: undefined, args: [] }) }
  }
  const isNested = decoratorEntries(field).some((entry) => entry.decorator === 'ValidateNested')
  if (isNested && field.each) {
    return { type: 'array', items: baseFieldSchema(field) }
  }
  return baseFieldSchema(field)
}

/** Fields excluded by `expose: false`, paired with which of the remaining ones are `required`
 * (`!optional`, checked only among the exposed fields — never derived from the full, unfiltered set). */
function exposedEntries(
  fields: DiscoveredRtoFields | undefined,
): [string, DiscoveredRtoFieldMetadata][] {
  if (!fields) return []
  return Object.entries(fields).filter(([, field]) => field.expose)
}

/** Turns a `Body` RTO's fields into an OpenAPI object schema — `expose: false` fields never appear
 * in `properties` at all (never just omitted from `required`), and `required` lists every exposed
 * field that isn't `optional`. */
function fieldsToObjectSchema(fields: DiscoveredRtoFields | undefined): OpenapiObjectSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [name, field] of exposedEntries(fields)) {
    properties[name] = fieldToSchema(field)
    if (!field.optional) required.push(name)
  }

  return required.length ? { type: 'object', properties, required } : { type: 'object', properties }
}

/** Turns a `Params`/`Search` RTO's fields into individual OpenAPI parameters — same `expose`/
 * `required` rules as {@linkcode fieldsToObjectSchema}, just shaped as a list instead of an object. */
function fieldsToParameters(
  fields: DiscoveredRtoFields | undefined,
  location: OpenapiParameter['in'],
): OpenapiParameter[] {
  return exposedEntries(fields).map(([name, field]) => ({
    name,
    in: location,
    required: !field.optional,
    schema: fieldToSchema(field),
  }))
}

/** Rewrites a Zanix `:param`-style path segment (`@zanix/server`'s own `pathToRegex` convention,
 * optionally suffixed `?`/`*`) into OpenAPI's `{param}` style — `/items/:id` → `/items/{id}`. */
function toOpenapiPath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? `{${segment.slice(1).replace(/[?*]+$/, '')}}` : segment
    )
    .join('/')
}

/** A deterministic, readable `operationId` for one route — its HTTP method plus a slugified path,
 * since neither `@zanix/server`'s own route metadata nor this generator's CLI options carry a
 * dedicated per-route name to draw from instead. */
function toOperationId(route: DiscoveredRoute): string {
  const slug = route.path.replace(/^\//, '').replace(/[/:{}]+/g, '_').replace(/_+$/, '')
  return `${route.httpMethod.toLowerCase()}_${slug || 'root'}`
}

/**
 * Builds a minimal OpenAPI 3.0.3 document from a project's own discovered REST routes — pure,
 * data-in/data-out: no I/O, no subprocess awareness, nothing about how `routes` was obtained.
 * `discover.ts` owns getting the real data across the process boundary; this function owns turning
 * it into a spec.
 *
 * Two routes at the same path (different HTTP methods) merge into one `paths` entry, one operation
 * per method — never overwrite each other. `info.title`/`info.version` are fixed placeholders:
 * this function's own single-argument signature has no project name/version to draw from, and
 * widening it isn't warranted for two constant strings a future iteration can revisit if a real
 * need for them shows up.
 *
 * @param routes - Every REST route to include, already filtered (if `--application` was passed) by
 * the caller — this function has no opinion about which routes are in scope, only how to render them.
 */
export function planOpenapiSpec(routes: DiscoveredRoute[]): OpenapiSpec {
  const paths: Record<string, OpenapiPathItem> = {}

  for (const route of routes) {
    const openapiPath = toOpenapiPath(route.path)
    const method = route.httpMethod.toLowerCase() as keyof OpenapiPathItem

    const parameters = [
      ...fieldsToParameters(route.rto?.Params, 'path'),
      ...fieldsToParameters(route.rto?.Search, 'query'),
    ]

    const operation: OpenapiOperation = {
      operationId: toOperationId(route),
      tags: [route.application],
      responses: { '200': { description: 'Successful response.' } },
    }
    if (parameters.length) operation.parameters = parameters
    if (route.rto?.Body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: fieldsToObjectSchema(route.rto.Body) } },
      }
    }

    paths[openapiPath] = { ...paths[openapiPath], [method]: operation }
  }

  return {
    openapi: '3.0.3',
    info: { title: 'Zanix API', version: '1.0.0' },
    paths,
  }
}
