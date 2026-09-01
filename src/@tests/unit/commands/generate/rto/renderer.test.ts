import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { FieldDef } from 'commands/generate/rto/parser.ts'
import { rtoTemplate } from 'commands/generate/rto/renderer.ts'

const field = (overrides: Partial<FieldDef>): FieldDef => ({
  name: 'field',
  type: 'string',
  isArray: false,
  optional: false,
  ...overrides,
})

Deno.test('rtoTemplate: always emits Search/Get/Create/Edit for the given entity name', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'amount', type: 'number' }),
  ])

  assertStringIncludes(
    output,
    'export class SearchPaymentRTO extends SearchPaginationRTO',
  )
  assertStringIncludes(output, 'export class GetPaymentRTO extends BaseRTO')
  assertStringIncludes(output, 'export class PaymentRTO extends BaseRTO')
  assertStringIncludes(output, 'export class EditPaymentRTO extends BaseRTO')
})

Deno.test('rtoTemplate: Search has only an optional query, Get only a required id', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'amount', type: 'number' }),
  ])

  const search = output.split('export class GetPaymentRTO')[0]
  assertStringIncludes(search, 'accessor query: string | undefined')

  const get = output.split('export class GetPaymentRTO')[1].split(
    'export class PaymentRTO',
  )[0]
  assertStringIncludes(get, '@IsObjectID({ expose: true })')
  assertStringIncludes(get, 'accessor id!: string')
})

Deno.test('rtoTemplate: a required field is non-null on Create, optional on Edit', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'name', type: 'string' }),
  ])

  const create = output.split('export class PaymentRTO')[1].split(
    'export class EditPaymentRTO',
  )[0]
  assertStringIncludes(create, '@IsString({ expose: true })')
  assertStringIncludes(create, 'accessor name!: string')

  const edit = output.split('export class EditPaymentRTO')[1]
  assertStringIncludes(edit, '@IsString({ expose: true, optional: true })')
  assertStringIncludes(edit, 'accessor name: string | undefined')
})

Deno.test('rtoTemplate: an already-optional field stays optional on Create too', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'note', type: 'string', optional: true }),
  ])
  const create = output.split('export class PaymentRTO')[1].split(
    'export class EditPaymentRTO',
  )[0]

  assertStringIncludes(create, '@IsString({ expose: true, optional: true })')
  assertStringIncludes(create, 'accessor note: string | undefined')
})

Deno.test('rtoTemplate: an array field uses each: true and a wrapped array type', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'tags', type: 'string', isArray: true }),
  ])

  assertStringIncludes(output, '@IsString({ expose: true, each: true })')
  assertStringIncludes(output, 'accessor tags!: (string)[]')
})

Deno.test('rtoTemplate: IsNumber/IsDate never receive `expose` (real validator constraint)', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'amount', type: 'number' }),
    field({ name: 'dueDate', type: 'date' }),
  ])

  assertStringIncludes(output, '@IsNumber()\n  accessor amount!: number')
  assertStringIncludes(output, '@IsDate()\n  accessor dueDate!: Date')
  assert(!output.includes('@IsNumber({ expose'))
  assert(!output.includes('@IsDate({ expose'))
})

Deno.test('rtoTemplate: IsNumber/IsDate still take `optional` on Edit, just never `expose`', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'amount', type: 'number' }),
  ])
  const edit = output.split('export class EditPaymentRTO')[1]

  assertStringIncludes(edit, '@IsNumber({ optional: true })')
})

Deno.test('rtoTemplate: an enum field renders the values array and a TS union type', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'status', type: 'enum', enumValues: ['ACTIVE', 'INACTIVE'] }),
  ])

  assertStringIncludes(
    output,
    "@IsEnum(['ACTIVE', 'INACTIVE'], { expose: true })",
  )
  assertStringIncludes(output, "accessor status!: 'ACTIVE' | 'INACTIVE'")
  assertStringIncludes(
    output,
    "import { BaseRTO, IsEnum, IsObjectID, IsString } from '@zanix/validator'",
  )
})

Deno.test('rtoTemplate: an enum field with no enumValues falls back to an empty list', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'status', type: 'enum', enumValues: undefined }),
  ])

  assertStringIncludes(output, '@IsEnum([], { expose: true })')
  assertStringIncludes(output, 'accessor status!: ')
})

Deno.test('rtoTemplate: an objectId field imports IsObjectID once, from @zanix/validator', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'currencyId', type: 'objectId' }),
    field({ name: 'accountId', type: 'objectId' }),
  ])

  const importLine = "import { BaseRTO, IsObjectID, IsString } from '@zanix/validator'"
  const occurrences = output.split(importLine).length - 1
  assertEquals(occurrences, 1)
  assert(!output.includes("from './validations/IsObjectID.ts'"))
})

Deno.test('rtoTemplate: a permission field renders a plain IsString, no local import', () => {
  // No dedicated `IsPermission` decorator/validator exists anywhere in the ecosystem (a real,
  // hand-templated `module:action` regex was investigated and removed for rejecting real
  // production permission strings — see `renderer.ts`'s own doc) — `permission` falls back to
  // exactly the same rendering as `string`.
  const output = rtoTemplate('Role', [
    field({ name: 'scope', type: 'permission' }),
  ])

  assertStringIncludes(output, '@IsString({ expose: true })\n  accessor scope!: string')
  assert(!output.includes('IsPermission'))
  assert(!output.includes("from './validations/"))
})

Deno.test('rtoTemplate: a zero-field create class renders `deno fmt`-clean (no blank line)', () => {
  // Real repro: `zanix new server`'s default scaffold calls `planRto('example', 'Example', [],
  // folder)` — an empty `fields` array. Only the create class (`${pascalName}RTO`, built from the
  // raw `fields` with no synthetic field always added) can actually hit zero fields; `Search`/
  // `Get`/`Edit` always render `QUERY_FIELD`/`ID_FIELD`. A naive `{\n${renderClassBody([])}\n}`
  // leaves a literal blank line between `{` and `}` that `deno fmt` flags and reformats away —
  // this asserts the generator emits that already-clean shape directly.
  const output = rtoTemplate('Example', [])

  assertStringIncludes(
    output,
    'export class ExampleRTO extends BaseRTO {\n}',
  )
  assert(!output.includes('export class ExampleRTO extends BaseRTO {\n\n}'))
})

Deno.test('rtoTemplate: validator import list is deduped and alphabetically sorted', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'a', type: 'string' }),
    field({ name: 'b', type: 'string' }),
    field({ name: 'c', type: 'boolean' }),
  ])

  assertStringIncludes(
    output,
    "import { BaseRTO, IsBoolean, IsObjectID, IsString } from '@zanix/validator'",
  )
})
