/**
 * Renderer for `zanix generate rto <name> --field <spec>` — consumes the structured `FieldDef`
 * model from `./parser.ts` (zero DSL-string knowledge) and holds all decorator/codegen domain
 * knowledge (`FIELD_TYPE_INFO`: which `@zanix/validator` decorator, TS type, local-import flag,
 * `expose` eligibility).
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
 * the top, not four separate files. `IsObjectID`/`IsPermission` are hand-invented per project (not
 * part of `@zanix/validator`) — generated once into `handlers/rtos/validations/` the first time a
 * field actually needs one.
 */

import type { FieldDef, FieldType } from './parser.ts'

/** Maps each non-enum `FieldType` to the real decorator/TS type it renders as. */
export const FIELD_TYPE_INFO: Record<
  Exclude<FieldType, 'enum'>,
  { decorator: string; tsType: string; localImport?: true; noExpose?: true }
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
  // Hand-invented, not part of `@zanix/validator` — generated alongside into
  // `handlers/rtos/validations/` the first time either is actually used (see below).
  objectId: { decorator: 'IsObjectID', tsType: 'string', localImport: true },
  permission: {
    decorator: 'IsPermission',
    tsType: 'string',
    localImport: true,
  },
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
  /** Whether `decorator` comes from `./validations/*.ts` instead of `@zanix/validator`. */
  isLocal: boolean
}

function renderField(field: FieldDef, forceOptional: boolean): RenderedField {
  const isOptional = forceOptional || field.optional

  let decorator: string
  let scalarType: string
  let isLocal: boolean
  let noExpose: boolean

  if (field.type === 'enum') {
    decorator = 'IsEnum'
    scalarType = (field.enumValues ?? []).map((value) => `'${value}'`).join(
      ' | ',
    )
    isLocal = false
    noExpose = false
  } else {
    const info = FIELD_TYPE_INFO[field.type]
    decorator = info.decorator
    scalarType = info.tsType
    isLocal = Boolean(info.localImport)
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
    isLocal,
  }
}

function renderClassBody(rendered: RenderedField[]): string {
  return rendered.map((field) => field.line).join('\n')
}

/**
 * Generates the full `handlers/rtos/<name>.ts` (or `.rto.ts`) content for one entity: `Search`,
 * `Get`, create, and `Edit` RTOs, sharing one deduped import block at the top — matching every
 * real multi-class RTO file sampled (`entities.ts`, `wallets.rto.ts`, ...).
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

  const validatorNames = new Set<string>(['BaseRTO', 'IsString'])
  for (const field of allRendered) {
    if (!field.isLocal) validatorNames.add(field.decorator)
  }
  const validatorImport = `import { ${
    [...validatorNames].sort().join(', ')
  } } from '@zanix/validator'`

  // `IsObjectID` is unconditionally imported: `getField`/`editFields[0]` always render the `id`
  // field (see `ID_FIELD`), so it's always needed — no field combination ever omits it. Only
  // `IsPermission` is genuinely conditional (not every entity has a `permission`-typed field).
  const usesPermission = allRendered.some((field) => field.decorator === 'IsPermission')

  const imports = [
    validatorImport,
    `import { IsObjectID } from './validations/IsObjectID.ts'`,
    usesPermission &&
    `import { IsPermission } from './validations/IsPermission.ts'`,
    `import { SearchPaginationRTO } from '@zanix/datamaster'`,
  ].filter(Boolean).join('\n')

  return `${imports}

export class Search${pascalName}RTO extends SearchPaginationRTO {
${renderClassBody([searchField])}
}

export class Get${pascalName}RTO extends BaseRTO {
${renderClassBody([getField])}
}

export class ${pascalName}RTO extends BaseRTO {
${renderClassBody(createFields)}
}

export class Edit${pascalName}RTO extends BaseRTO {
${renderClassBody(editFields)}
}
`
}

/**
 * `handlers/rtos/validations/IsObjectID.ts` — hand-invented in every real project sampled (not
 * part of `@zanix/validator`). Content verbatim from the array-aware version found in 2/4 real
 * repos (the other 2 predate array support) — the more complete, still-100%-compatible variant.
 */
export const isObjectIdTemplate = (): string =>
  `import type { ValidationOptions } from '@zanix/types'

import { Validation } from '@zanix/validator'
import { OBJECTID_REGEX } from 'utils/constants.ts'

export const IsObjectID = (options?: ValidationOptions) => {
  return Validation((value) => {
    return Array.isArray(value)
      ? value.every((val) => OBJECTID_REGEX.test(val))
      : OBJECTID_REGEX.test(value)
  }, { message: (property) => \`The property '\${property}' should be a valid ID\`, ...options })
}
`

/**
 * `handlers/rtos/validations/IsPermission.ts` — verbatim from the one real example found;
 * not universal (only present where a project actually validates permission
 * strings on an RTO), so only generated when a field actually uses it.
 */
export const isPermissionTemplate = (): string =>
  `import type { ValidationOptions } from '@zanix/types'
import { Validation } from '@zanix/validator'
import { PERMISSION_REGEX } from 'utils/constants.ts'

export const IsPermission = (options?: ValidationOptions) => {
  return Validation((value) => {
    return PERMISSION_REGEX.test(value)
  }, {
    message: (property) =>
      \`The property '\${property}' must be a valid permission identifier in the format \
'module:action', using only letters and hyphens.\`,
    ...options,
  })
}
`

/** The regex constant `IsObjectID.ts` imports from a generated project's own
 * `src/utils/constants.ts` — a hand-typed string literal, not derived from this package's own
 * `utils/constants.ts` `OBJECTID_REGEX` (see that constant's own doc) — keep both in sync by hand
 * if either one's pattern ever changes. */
export const OBJECTID_REGEX_CONSTANT = 'export const OBJECTID_REGEX = /^[0-9a-fA-F]{24}$/'

/** The regex constant `IsPermission.ts` imports from a generated project's own
 * `src/utils/constants.ts` — a hand-typed string literal, same convention as
 * `OBJECTID_REGEX_CONSTANT` above, but with no sibling `PERMISSION_REGEX` of its own in this
 * package's own `utils/constants.ts` to stay in sync with — this string is its only source. */
export const PERMISSION_REGEX_CONSTANT = 'export const PERMISSION_REGEX = /^[A-Za-z-]+:[A-Za-z-]+$/'
