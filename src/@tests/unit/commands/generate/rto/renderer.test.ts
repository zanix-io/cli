import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { FieldDef } from 'commands/generate/rto/parser.ts'
import {
  isObjectIdTemplate,
  isPermissionTemplate,
  OBJECTID_REGEX_CONSTANT,
  PERMISSION_REGEX_CONSTANT,
  rtoTemplate,
} from 'commands/generate/rto/renderer.ts'

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
    "import { BaseRTO, IsEnum, IsString } from '@zanix/validator'",
  )
})

Deno.test('rtoTemplate: an enum field with no enumValues falls back to an empty list', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'status', type: 'enum', enumValues: undefined }),
  ])

  assertStringIncludes(output, '@IsEnum([], { expose: true })')
  assertStringIncludes(output, 'accessor status!: ')
})

Deno.test('rtoTemplate: an objectId field imports IsObjectID once, from ./validations/', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'currencyId', type: 'objectId' }),
    field({ name: 'accountId', type: 'objectId' }),
  ])

  const importLine = "import { IsObjectID } from './validations/IsObjectID.ts'"
  const occurrences = output.split(importLine).length - 1
  assertEquals(occurrences, 1)
  assert(!output.includes("IsObjectID } from '@zanix/validator'"))
})

Deno.test('rtoTemplate: only imports IsPermission when a field actually uses it', () => {
  const withPermission = rtoTemplate('Role', [
    field({ name: 'scope', type: 'permission' }),
  ])
  assertStringIncludes(
    withPermission,
    "import { IsPermission } from './validations/IsPermission.ts'",
  )

  const withoutPermission = rtoTemplate('Role', [
    field({ name: 'name', type: 'string' }),
  ])
  assert(!withoutPermission.includes('IsPermission'))
})

Deno.test('rtoTemplate: validator import list is deduped and alphabetically sorted', () => {
  const output = rtoTemplate('Payment', [
    field({ name: 'a', type: 'string' }),
    field({ name: 'b', type: 'string' }),
    field({ name: 'c', type: 'boolean' }),
  ])

  assertStringIncludes(
    output,
    "import { BaseRTO, IsBoolean, IsString } from '@zanix/validator'",
  )
})

Deno.test('isObjectIdTemplate/isPermissionTemplate: content matches real production files', () => {
  const objectId = isObjectIdTemplate()
  assertStringIncludes(
    objectId,
    "import { OBJECTID_REGEX } from 'utils/constants.ts'",
  )
  assertStringIncludes(objectId, 'Array.isArray(value)')
  assertStringIncludes(
    objectId,
    'export const IsObjectID = (options?: ValidationOptions) => {',
  )

  const permission = isPermissionTemplate()
  assertStringIncludes(
    permission,
    "import { PERMISSION_REGEX } from 'utils/constants.ts'",
  )
  assertStringIncludes(
    permission,
    "must be a valid permission identifier in the format 'module:action'",
  )
})

Deno.test('OBJECTID_REGEX_CONSTANT/PERMISSION_REGEX_CONSTANT: verbatim declarations', () => {
  assertEquals(
    OBJECTID_REGEX_CONSTANT,
    'export const OBJECTID_REGEX = /^[0-9a-fA-F]{24}$/',
  )
  assertEquals(
    PERMISSION_REGEX_CONSTANT,
    'export const PERMISSION_REGEX = /^[A-Za-z-]+:[A-Za-z-]+$/',
  )
})
