import { assertEquals, assertThrows } from '@std/assert'
import { parseFields, parseFieldSpec } from 'commands/generate/rto/parser.ts'

Deno.test('parseFieldSpec: required scalar fields for every supported type', () => {
  assertEquals(parseFieldSpec('name:string'), {
    name: 'name',
    type: 'string',
    isArray: false,
    optional: false,
    enumValues: undefined,
  })
  assertEquals(parseFieldSpec('age:number').type, 'number')
  assertEquals(parseFieldSpec('active:boolean').type, 'boolean')
  assertEquals(parseFieldSpec('email:email').type, 'email')
  assertEquals(parseFieldSpec('dueDate:date').type, 'date')
  assertEquals(parseFieldSpec('ref:uuid').type, 'uuid')
  assertEquals(parseFieldSpec('userId:objectId').type, 'objectId')
  assertEquals(parseFieldSpec('scope:permission').type, 'permission')
})

Deno.test('parseFieldSpec: optional marker (?)', () => {
  const field = parseFieldSpec('name:string?')
  assertEquals(field.optional, true)
  assertEquals(field.isArray, false)
})

Deno.test('parseFieldSpec: array marker ([])', () => {
  const field = parseFieldSpec('tags:string[]')
  assertEquals(field.isArray, true)
  assertEquals(field.optional, false)
})

Deno.test('parseFieldSpec: optional array ([]?)', () => {
  const field = parseFieldSpec('tags:string[]?')
  assertEquals(field.isArray, true)
  assertEquals(field.optional, true)
})

Deno.test('parseFieldSpec: enum field parses its values in order', () => {
  const field = parseFieldSpec('status:enum(ACTIVE,INACTIVE,PENDING)')
  assertEquals(field.type, 'enum')
  assertEquals(field.enumValues, ['ACTIVE', 'INACTIVE', 'PENDING'])
})

Deno.test('parseFieldSpec: enum field trims spaces around each value', () => {
  const field = parseFieldSpec('status:enum(ACTIVE, INACTIVE , PENDING)')
  assertEquals(field.enumValues, ['ACTIVE', 'INACTIVE', 'PENDING'])
})

Deno.test('parseFieldSpec: optional enum field', () => {
  const field = parseFieldSpec('status:enum(ACTIVE,INACTIVE)?')
  assertEquals(field.optional, true)
  assertEquals(field.enumValues, ['ACTIVE', 'INACTIVE'])
})

Deno.test('parseFieldSpec: rejects a spec with no colon', () => {
  assertThrows(() => parseFieldSpec('name'), Error, "Invalid --field 'name'")
})

Deno.test('parseFieldSpec: rejects an unsupported type', () => {
  assertThrows(
    () => parseFieldSpec('name:currency'),
    Error,
    "Unsupported field type 'currency'",
  )
})

Deno.test('parseFieldSpec: rejects an enum with no values', () => {
  assertThrows(
    () => parseFieldSpec('status:enum()'),
    Error,
    "enum field 'status' needs at least one value",
  )
})

Deno.test('parseFields: parses every spec in order', () => {
  const fields = parseFields(['name:string', 'age:number?'])
  assertEquals(fields.map((field) => field.name), ['name', 'age'])
})

Deno.test('parseFields: throws a clear error when given an empty list', () => {
  assertThrows(
    () => parseFields([]),
    Error,
    "The 'rto' generator needs at least one --field",
  )
})
