import { assertThrows } from '@std/assert'
import { assertValidMeshIdentities } from 'commands/credentials/mesh/validate.ts'
import { Commander } from 'cli'

Deno.test('assertValidMeshIdentities throws for 0 identities', () => {
  assertThrows(
    () => assertValidMeshIdentities(new Commander(), []),
    Error,
    'needs at least 2 cooperating identities, got 0',
  )
})

Deno.test('assertValidMeshIdentities throws for exactly 1 identity', () => {
  assertThrows(
    () => assertValidMeshIdentities(new Commander(), ['billing']),
    Error,
    'needs at least 2 cooperating identities, got 1',
  )
})

Deno.test('assertValidMeshIdentities does not throw for 2 identities', () => {
  assertValidMeshIdentities(new Commander(), ['billing', 'zanix-admin'])
})

Deno.test('assertValidMeshIdentities does not throw for 3+ identities', () => {
  assertValidMeshIdentities(new Commander(), ['billing', 'zanix-admin', 'templates'])
})

Deno.test('assertValidMeshIdentities throws on a duplicate identity', () => {
  assertThrows(
    () => assertValidMeshIdentities(new Commander(), ['billing', 'billing']),
    Error,
    'Duplicate identity "billing"',
  )
})

Deno.test('assertValidMeshIdentities throws on an identity containing whitespace', () => {
  assertThrows(
    () => assertValidMeshIdentities(new Commander(), ['billing app', 'zanix-admin']),
    Error,
    'Invalid identity "billing app"',
  )
})

Deno.test('assertValidMeshIdentities throws on an identity containing "="', () => {
  assertThrows(
    () => assertValidMeshIdentities(new Commander(), ['billing=x', 'zanix-admin']),
    Error,
    'Invalid identity "billing=x"',
  )
})

Deno.test('assertValidMeshIdentities accepts hyphens and underscores', () => {
  assertValidMeshIdentities(new Commander(), ['zanix-admin', 'billing_v2'])
})
