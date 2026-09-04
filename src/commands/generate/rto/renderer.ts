/**
 * Renderer for `zanix generate rto <name> --field <spec>` — consumes the structured `FieldDef`
 * model from `./parser.ts` (zero DSL-string knowledge) and holds all decorator/codegen domain
 * knowledge (`FIELD_TYPE_INFO`: which `@zanix/validator` decorator, TS type, `expose`
 * eligibility).
 *
 * Embedded as string-template functions (not read from separate files), same reason as
 * `seeder/template.ts`/`repository/template.ts`/`handler/template.ts`: `zanix build` bundles this
 * command's code into a single `.dist/app.mjs` output by default.
 *
 * Shape confirmed against real files in 4 production repos: **one
 * file per entity** (`handlers/rtos/<name>.ts` or `<name>.rto.ts`) holding every RTO for that
 * entity — a `Search<Entity>RTO extends SearchPaginationRTO` (just an optional `query`), a
 * `Get<Entity>RTO` (`id` only), the `<Entity>RTO` (create — required fields), and
 * `Edit<Entity>RTO` (every field optional, plus `id`) — with one shared, deduped import block at
 * the top, not four separate files. `IsObjectID` is a real `@zanix/validator` decorator (mirrors
 * `IsUUID`'s own shape exactly, published since `@zanix/utils@2.7.0`, well below `cli`'s own
 * `^3.0.0` floor for that subpath — see `ZANIX_DEPENDENCY_VERSIONS`'s own doc in
 * `utils/config/dependencies.ts`), rendered the same way as `IsEmail`/`IsUUID`.
 *
 * `permission` renders as a bare `IsString` — investigated and confirmed there is no real,
 * enforced "permission format" anywhere in the ecosystem to validate against: `@zanix/admin` uses
 * real, in-production hierarchical strings (`zanix:admin:triggers`) a `module:action`-shaped regex
 * would reject, alongside equally real flat strings (`'admin'`); `@zanix/auth`'s own comparison
 * logic (`scopeValidation`) does exact-Set-membership + wildcard `'*'` matching and never parses
 * or splits a permission string at all. A previous hand-templated `PERMISSION_REGEX`/
 * `IsPermission.ts` (requiring exactly one `:`) was removed for exactly that reason — it rejected
 * real production values. `permission` stays a distinct `FieldType` (still semantically
 * meaningful in a `--field` spec) but has no dedicated decorator to converge toward, so it falls
 * back to the same plain type-check every other decoratorless-in-practice string field gets —
 * see `FIELD_TYPE_INFO`'s own `string`/`permission` entries below, intentionally identical.
 */

import type { FieldDef, FieldType } from './parser.ts'

/** Maps each non-enum `FieldType` to the real decorator/TS type it renders as. */
export const FIELD_TYPE_INFO: Record<
  Exclude<FieldType, 'enum'>,
  { decorator: string; tsType: string; noExpose?: true }
> = {
  string: { decorator: 'IsString', tsType: 'string' },
  // `IsNumber`/`IsDate` are typed against `DefaultTransformValidationOpts`
  // (`@zanix/utils/src/typings/validations.ts`), which `Omit`s `expose` from the options object
  // entirely (confirmed against the real published package via `deno check` — passing `expose`
  // here is a real `TS2353` type error, not just unnecessary). Every other decorator here keeps
  // the plain `ValidationOptions` shape and takes `expose` normally.
  number: { decorator: 'IsNumber', tsType: 'number', noExpose: true },
  boolean: { decorator: 'IsBoolean', tsType: 'boolean' },
  email: { decorator: 'IsEmail', tsType: 'string' },
  date: { decorator: 'IsDate', tsType: 'Date', noExpose: true },
  uuid: { decorator: 'IsUUID', tsType: 'string' },
  // Real `@zanix/validator` decorator, same shape as `IsUUID` above — see this file's own top
  // doc comment for the pending-publish caveat.
  objectId: { decorator: 'IsObjectID', tsType: 'string' },
  // No real decorator/pattern exists anywhere in the ecosystem for a "permission string" (see
  // this file's own top doc comment) — renders identically to `string` above, on purpose (not a
  // separate entry with the same values by coincidence).
  permission: { decorator: 'IsString', tsType: 'string' },
}

/** The synthetic `id` field every `Get`/`Edit` RTO carries — always a required `objectId`. */
const ID_FIELD: FieldDef = {
  name: 'id',
  type: 'objectId',
  isArray: false,
  optional: false,
}

/** The synthetic `query` field every `Search` RTO carries — always an optional `string`. */
const QUERY_FIELD: FieldDef = {
  name: 'query',
  type: 'string',
  isArray: false,
  optional: true,
}

type RenderedField = {
  /** The decorator + accessor lines, ready to join into a class body. */
  line: string
  /** The decorator name used (`IsString`, `IsEnum`, `IsObjectID`, ...). */
  decorator: string
}

function renderField(field: FieldDef, forceOptional: boolean): RenderedField {
  const isOptional = forceOptional || field.optional

  let decorator: string
  let scalarType: string
  let noExpose: boolean

  if (field.type === 'enum') {
    decorator = 'IsEnum'
    scalarType = (field.enumValues ?? []).map((value) => `'${value}'`).join(
      ' | ',
    )
    noExpose = false
  } else {
    const info = FIELD_TYPE_INFO[field.type]
    decorator = info.decorator
    scalarType = info.tsType
    noExpose = Boolean(info.noExpose)
  }

  // Matches the real, observed option order: `expose`, then `each` (if an array), then
  // `optional` (if optional) — e.g. `@IsObjectID({ expose: true, each: true, optional: true })`.
  // `noExpose`-marked decorators (`IsNumber`/`IsDate`) never take `expose` at all — see
  // `FIELD_TYPE_INFO`'s own comment for why.
  const optionParts = noExpose ? [] : ['expose: true']
  if (field.isArray) optionParts.push('each: true')
  if (isOptional) optionParts.push('optional: true')
  // A `noExpose` decorator with no array/optional modifiers either has nothing left to pass —
  // matches the real doc example's bare `@IsNumber()`, not an empty `@IsNumber({})`.
  const optionsArg = optionParts.length ? `{ ${optionParts.join(', ')} }` : ''

  const decoratorArgs = field.type === 'enum'
    ? `[${(field.enumValues ?? []).map((value) => `'${value}'`).join(', ')}], ${optionsArg}`
    : optionsArg

  const tsType = field.isArray ? `(${scalarType})[]` : scalarType
  const accessor = isOptional
    ? `accessor ${field.name}: ${tsType} | undefined`
    : `accessor ${field.name}!: ${tsType}`

  return {
    line: `  @${decorator}(${decoratorArgs})\n  ${accessor}`,
    decorator,
  }
}

function renderClassBody(rendered: RenderedField[]): string {
  return rendered.map((field) => field.line).join('\n')
}

/**
 * Renders one full class declaration (`export class <header> {\n...\n}`), `deno fmt`-clean for
 * any field count — including zero. A naive `{\n${renderClassBody(fields)}\n}` produces a
 * literal blank line between `{` and `}` when `fields` is empty (`renderClassBody([])` is `''`,
 * but the template literal's own fixed newlines around it remain), which `deno fmt` then flags
 * and reformats to a bare `{\n}`. This renders that already-clean shape directly instead of
 * relying on a post-hoc reformat. Only the create class (`${pascalName}RTO`, built from the raw,
 * user-supplied `fields` with no synthetic field always added — see `rtoTemplate`) can actually
 * hit zero fields today (`Search`/`Get`/`Edit` always include `QUERY_FIELD`/`ID_FIELD`), but all
 * four class declarations go through this same helper for one consistent rendering path.
 */
function renderClass(header: string, rendered: RenderedField[]): string {
  const body = renderClassBody(rendered)
  return body ? `${header} {\n${body}\n}` : `${header} {\n}`
}

/**
 * Generates the full `handlers/rtos/<name>.ts` (or `.rto.ts`) content for one entity: `Search`,
 * `Get`, create, and `Edit` RTOs, sharing one deduped import block at the top — matching every
 * real multi-class RTO file sampled (`entities.ts`, `wallets.rto.ts`, ...).
 *
 * `fields` may be empty (e.g. `zanix new server`'s default scaffold calls this with `[]`) — the
 * create class (`${pascalName}RTO`) then has zero fields; every class declaration goes through
 * `renderClass`, which keeps the output `deno fmt`-clean (a bare `{\n}`, no blank line) in that
 * case rather than emitting an empty body that `deno fmt` would flag and reformat.
 */
export function rtoTemplate(pascalName: string, fields: FieldDef[]): string {
  const searchField = renderField(QUERY_FIELD, false)
  const getField = renderField(ID_FIELD, false)
  const createFields = fields.map((field) => renderField(field, false))
  const editFields = [
    renderField(ID_FIELD, false),
    ...fields.map((field) => renderField(field, true)),
  ]

  const allRendered = [searchField, getField, ...createFields, ...editFields]

  // Every decorator here is a real `@zanix/validator` export — no field type renders a local
  // import anymore (`objectId` is a real decorator, `permission` falls back to plain `IsString`,
  // see `FIELD_TYPE_INFO`'s own doc above), so nothing needs filtering out of this set.
  const validatorNames = new Set<string>(['BaseRTO', 'IsString'])
  for (const field of allRendered) validatorNames.add(field.decorator)
  const validatorImport = `import { ${
    [...validatorNames].sort().join(', ')
  } } from '@zanix/validator'`

  const imports = [
    validatorImport,
    `import { SearchPaginationRTO } from '@zanix/datamaster'`,
  ].join('\n')

  return `${imports}

${
    renderClass(`export class Search${pascalName}RTO extends SearchPaginationRTO`, [
      searchField,
    ])
  }

${renderClass(`export class Get${pascalName}RTO extends BaseRTO`, [getField])}

${renderClass(`export class ${pascalName}RTO extends BaseRTO`, createFields)}

${renderClass(`export class Edit${pascalName}RTO extends BaseRTO`, editFields)}
`
}
