/**
 * Field DSL parser for `zanix generate rto <name> --field <spec>` — pure DSL-string → structured
 * `FieldDef` syntax, no decorator/codegen knowledge (that lives in `./renderer.ts`). Each `--field`
 * flag is one spec:
 *
 *   name:type            required field
 *   name:type?           optional field
 *   name:type[]          required array field (`each: true`)
 *   name:type[]?         optional array field
 *   name:enum(A,B,C)     enum field (values become both the decorator's list and the TS union)
 *
 * Supported `type`s mirror what real `@zanix/validator` decorators actually cover: `string`,
 * `number`, `boolean`, `email`, `date`, `uuid`, `objectId`, plus `enum(...)`. `permission` is also
 * supported (still a meaningful label in a `--field` spec) even though it has no dedicated
 * decorator of its own — it renders identically to `string`; see `./renderer.ts`'s own doc for why
 * a previous hand-invented `IsPermission` validator was removed rather than kept/replaced.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'email'
  | 'date'
  | 'uuid'
  | 'objectId'
  | 'permission'
  | 'enum'

export type FieldDef = {
  name: string
  type: FieldType
  isArray: boolean
  optional: boolean
  /** Only set when `type === 'enum'` — the literal values, in the order given. */
  enumValues?: string[]
}

// Kept independent from `./renderer.ts`'s `FIELD_TYPE_INFO` on purpose — the parser has no
// decorator/codegen knowledge. Must be kept in sync by hand with `FIELD_TYPE_INFO`'s keys whenever
// a new `FieldType` is added; nothing enforces this across the file boundary automatically.
const SUPPORTED_TYPES: Exclude<FieldType, 'enum'>[] = [
  'string',
  'number',
  'boolean',
  'email',
  'date',
  'uuid',
  'objectId',
  'permission',
]

const FIELD_SPEC_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]*):(enum\(([^)]*)\)|[a-zA-Z]+)(\[\])?(\?)?$/

/** Parses a single `--field` value. Throws a clear, actionable error on malformed input. */
export function parseFieldSpec(spec: string): FieldDef {
  const match = FIELD_SPEC_PATTERN.exec(spec.trim())
  if (!match) {
    throw new Error(
      `Invalid --field '${spec}'. Expected 'name:type', e.g. 'email:email', 'tags:string[]', ` +
        `'age:number?', or 'status:enum(ACTIVE,INACTIVE)'.`,
    )
  }

  const [, name, rawType, enumList, arrayMark, optionalMark] = match
  const isEnum = rawType.startsWith('enum(')

  if (
    !isEnum && !SUPPORTED_TYPES.includes(rawType as Exclude<FieldType, 'enum'>)
  ) {
    throw new Error(
      `Unsupported field type '${rawType}' in '--field ${spec}'. Supported types: ` +
        `${SUPPORTED_TYPES.join(', ')}, enum(...).`,
    )
  }

  const enumValues = isEnum
    ? enumList.split(',').map((value) => value.trim()).filter(Boolean)
    : undefined

  if (isEnum && !enumValues?.length) {
    throw new Error(
      `enum field '${name}' needs at least one value, e.g. '${name}:enum(ACTIVE,INACTIVE)'.`,
    )
  }

  return {
    name,
    type: isEnum ? 'enum' : rawType as FieldType,
    isArray: Boolean(arrayMark),
    optional: Boolean(optionalMark),
    enumValues,
  }
}

/**
 * Parses every `--field` value given to the command. Throws if none were given, or if two (or
 * more) specs share the same field `name` — each field becomes one `accessor` on the generated
 * RTO class, so a duplicate name would otherwise silently produce two class members with the
 * same identifier (invalid TypeScript) with no warning at generation time.
 */
export function parseFields(specs: string[]): FieldDef[] {
  if (specs.length === 0) {
    throw new Error(
      "The 'rto' generator needs at least one --field, e.g. --field name:string.",
    )
  }

  const fields = specs.map(parseFieldSpec)

  const seen = new Map<string, number>()
  for (const field of fields) {
    seen.set(field.name, (seen.get(field.name) ?? 0) + 1)
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1)

  if (duplicates.length > 0) {
    const detail = duplicates
      .map(([name, count]) => `'${name}' (given ${count} times)`)
      .join(', ')
    throw new Error(
      `Duplicate --field name(s): ${detail}. Each field needs a unique name.`,
    )
  }

  return fields
}
