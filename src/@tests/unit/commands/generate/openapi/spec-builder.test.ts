import { assertEquals } from '@std/assert'
import {
  type DiscoveredRoute,
  type DiscoveredRtoFieldMetadata,
  type DiscoveredRtoFields,
  fieldToSchema,
  planOpenapiSpec,
} from 'commands/generate/openapi/spec-builder.ts'

function field(overrides: Partial<DiscoveredRtoFieldMetadata> = {}): DiscoveredRtoFieldMetadata {
  return {
    decorator: undefined,
    args: [],
    each: false,
    optional: false,
    expose: true,
    ...overrides,
  }
}

Deno.test('fieldToSchema maps IsString to a string schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsString' })), { type: 'string' })
})

Deno.test('fieldToSchema maps IsNumber to a number schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsNumber' })), { type: 'number' })
})

Deno.test('fieldToSchema maps IsBoolean to a boolean schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsBoolean' })), { type: 'boolean' })
})

Deno.test('fieldToSchema maps IsArray to an array schema with an honest empty items schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsArray', each: true })), {
    type: 'array',
    items: {},
  })
})

Deno.test('fieldToSchema maps IsEnum with an array arg to a string schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsEnum', args: [['draft', 'published']] })), {
    type: 'string',
    enum: ['draft', 'published'],
  })
})

Deno.test('fieldToSchema maps IsEnum with an enum-like object arg to its values', () => {
  assertEquals(
    fieldToSchema(
      field({ decorator: 'IsEnum', args: [{ Draft: 'draft', Published: 'published' }] }),
    ),
    { type: 'string', enum: ['draft', 'published'] },
  )
})

Deno.test('fieldToSchema maps IsEnum with a missing arg to an empty enum, never a guess', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsEnum', args: [] })), {
    type: 'string',
    enum: [],
  })
})

Deno.test('fieldToSchema maps an unrecognized decorator to an honest empty schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'IsCustomThing' })), {})
})

Deno.test('fieldToSchema maps an undefined decorator to an honest empty schema', () => {
  assertEquals(fieldToSchema(field({ decorator: undefined })), {})
})

Deno.test('fieldToSchema maps ValidateNested to a real nested object schema, not {}', () => {
  const nested: DiscoveredRtoFields = {
    name: field({ decorator: 'IsString' }),
    age: field({ decorator: 'IsNumber', optional: true }),
  }
  assertEquals(fieldToSchema(field({ decorator: 'ValidateNested', args: [nested] })), {
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'number' } },
    required: ['name'],
  })
})

Deno.test('fieldToSchema maps ValidateNested + each:true to an array of nested objects', () => {
  const nested = { name: field({ decorator: 'IsString' }) }
  assertEquals(
    fieldToSchema(field({ decorator: 'ValidateNested', args: [nested], each: true })),
    {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  )
})

Deno.test('fieldToSchema maps an unresolved ValidateNested to an honest empty schema', () => {
  assertEquals(fieldToSchema(field({ decorator: 'ValidateNested', args: [] })), {
    type: 'object',
    properties: {},
  })
})

Deno.test('fieldToSchema recurses ValidateNested for a doubly-nested RTO', () => {
  const deepest = { flag: field({ decorator: 'IsBoolean' }) }
  const middle = { inner: field({ decorator: 'ValidateNested', args: [deepest] }) }
  assertEquals(fieldToSchema(field({ decorator: 'ValidateNested', args: [middle] })), {
    type: 'object',
    properties: {
      inner: { type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'] },
    },
    required: ['inner'],
  })
})

Deno.test('fieldToSchema merges every stacked decorator onto one schema, IsString + Length', () => {
  const stacked = field({
    decorator: 'Length',
    args: [{ min: 1, max: 100 }],
    decorators: [
      { decorator: 'IsString', args: [] },
      { decorator: 'Length', args: [{ min: 1, max: 100 }] },
    ],
  })
  assertEquals(fieldToSchema(stacked), { type: 'string', minLength: 1, maxLength: 100 })
})

Deno.test('fieldToSchema omits minLength/maxLength for Length defaults (0/Infinity)', () => {
  const stacked = field({
    decorator: 'Length',
    args: [{ min: 0, max: Infinity }],
    decorators: [
      { decorator: 'IsString', args: [] },
      { decorator: 'Length', args: [{ min: 0, max: Infinity }] },
    ],
  })
  assertEquals(fieldToSchema(stacked), { type: 'string' })
})

Deno.test('fieldToSchema treats a Length entry with no args[0] as an honest no-op', () => {
  assertEquals(fieldToSchema(field({ decorator: 'Length', args: [] })), {})
})

Deno.test('fieldToSchema finds a stacked ValidateNested, not just the field-wide decorator', () => {
  const nested = { name: field({ decorator: 'IsString' }) }
  const stacked = field({
    decorator: 'IsCustomThing',
    args: [],
    decorators: [
      { decorator: 'ValidateNested', args: [nested] },
      { decorator: 'IsCustomThing', args: [] },
    ],
  })
  assertEquals(fieldToSchema(stacked), {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  })
})

function route(overrides: Partial<DiscoveredRoute> = {}): DiscoveredRoute {
  return { httpMethod: 'GET', path: '/items', application: 'main', ...overrides }
}

Deno.test('planOpenapiSpec produces an empty paths object for no routes', () => {
  assertEquals(planOpenapiSpec([]), {
    openapi: '3.0.3',
    info: { title: 'Zanix API', version: '1.0.0' },
    paths: {},
  })
})

Deno.test('planOpenapiSpec builds a bare operation for a route with no rto at all', () => {
  const spec = planOpenapiSpec([route()])

  assertEquals(spec.paths['/items'].get, {
    operationId: 'get_items',
    tags: ['main'],
    responses: { '200': { description: 'Successful response.' } },
  })
})

Deno.test('planOpenapiSpec excludes expose:false fields from a Body schema entirely', () => {
  const spec = planOpenapiSpec([
    route({
      httpMethod: 'POST',
      rto: {
        Body: {
          name: field({ decorator: 'IsString' }),
          secret: field({ decorator: 'IsString', expose: false }),
        },
      },
    }),
  ])

  const schema = spec.paths['/items'].post?.requestBody?.content['application/json'].schema
  assertEquals(schema, {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  })
})

Deno.test('planOpenapiSpec derives required from !optional among exposed Body fields only', () => {
  const spec = planOpenapiSpec([
    route({
      httpMethod: 'POST',
      rto: {
        Body: {
          name: field({ decorator: 'IsString', optional: false }),
          nickname: field({ decorator: 'IsString', optional: true }),
        },
      },
    }),
  ])

  const schema = spec.paths['/items'].post?.requestBody?.content['application/json'].schema
  assertEquals(schema?.required, ['name'])
  assertEquals(Object.keys(schema?.properties ?? {}).sort(), ['name', 'nickname'])
})

Deno.test('planOpenapiSpec omits `required` when no exposed Body field is required', () => {
  const spec = planOpenapiSpec([
    route({
      httpMethod: 'POST',
      rto: { Body: { nickname: field({ decorator: 'IsString', optional: true }) } },
    }),
  ])

  const schema = spec.paths['/items'].post?.requestBody?.content['application/json'].schema
  assertEquals('required' in (schema ?? {}), false)
})

Deno.test('planOpenapiSpec turns Params fields into required path parameters', () => {
  const spec = planOpenapiSpec([
    route({
      path: '/items/:id',
      rto: { Params: { id: field({ decorator: 'IsString' }) } },
    }),
  ])

  assertEquals(spec.paths['/items/{id}'].get?.parameters, [
    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
  ])
})

Deno.test('planOpenapiSpec turns Search fields into query parameters, respecting optional', () => {
  const spec = planOpenapiSpec([
    route({
      rto: { Search: { page: field({ decorator: 'IsNumber', optional: true }) } },
    }),
  ])

  assertEquals(spec.paths['/items'].get?.parameters, [
    { name: 'page', in: 'query', required: false, schema: { type: 'number' } },
  ])
})

Deno.test('planOpenapiSpec excludes expose:false fields from Params/Search parameters too', () => {
  const spec = planOpenapiSpec([
    route({
      rto: { Search: { internal: field({ decorator: 'IsString', expose: false }) } },
    }),
  ])

  assertEquals(spec.paths['/items'].get?.parameters, undefined)
})

Deno.test('planOpenapiSpec merges two methods on the same path into one paths entry', () => {
  const spec = planOpenapiSpec([
    route({ httpMethod: 'GET' }),
    route({ httpMethod: 'POST', rto: { Body: { name: field({ decorator: 'IsString' }) } } }),
  ])

  assertEquals(Object.keys(spec.paths), ['/items'])
  assertEquals(spec.paths['/items'].get?.operationId, 'get_items')
  assertEquals(spec.paths['/items'].post?.operationId, 'post_items')
})

Deno.test('planOpenapiSpec converts :param segments to {param}, stripping ?/* markers', () => {
  const spec = planOpenapiSpec([
    route({ path: '/items/:id' }),
    route({ path: '/items/:id?' }),
    route({ path: '/files/:name*' }),
  ])

  assertEquals(Object.keys(spec.paths).sort(), ['/files/{name}', '/items/{id}'])
})

Deno.test('planOpenapiSpec derives a root-path operationId from the fallback slug', () => {
  const spec = planOpenapiSpec([route({ path: '/' })])
  assertEquals(spec.paths['/'].get?.operationId, 'get_root')
})

Deno.test('planOpenapiSpec renders a real nested object schema for a ValidateNested field', () => {
  const address: DiscoveredRtoFields = {
    city: field({ decorator: 'IsString' }),
  }
  const spec = planOpenapiSpec([
    route({
      httpMethod: 'POST',
      rto: {
        Body: {
          address: field({ decorator: 'ValidateNested', args: [address] }),
        },
      },
    }),
  ])

  const schema = spec.paths['/items'].post?.requestBody?.content['application/json'].schema
  assertEquals(schema, {
    type: 'object',
    properties: {
      address: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
    required: ['address'],
  })
})

Deno.test('planOpenapiSpec keeps each route tagged with its own Application', () => {
  const spec = planOpenapiSpec([
    route({ path: '/admin/items', application: 'admin' }),
    route({ path: '/items', application: 'main' }),
  ])

  assertEquals(spec.paths['/admin/items'].get?.tags, ['admin'])
  assertEquals(spec.paths['/items'].get?.tags, ['main'])
})
