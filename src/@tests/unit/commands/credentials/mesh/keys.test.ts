import { assertEquals, assertNotEquals, assertStringIncludes } from '@std/assert'
import { generateMeshKeyPairs } from 'commands/credentials/mesh/keys.ts'

Deno.test('returns one real, base64-encoded PKCS#8/SPKI keypair per identity', async () => {
  const keyPairs = await generateMeshKeyPairs(['billing', 'zanix-admin'])

  assertEquals(Object.keys(keyPairs).sort(), ['billing', 'zanix-admin'])

  for (const id of ['billing', 'zanix-admin']) {
    const { privateKey, publicKey } = keyPairs[id]

    // Base64-encoded — `@zanix/auth`'s own `btoa(privateKey)`/`btoa(publicKey)`
    // convention, not the raw multi-line PEM.
    const decodedPrivate = atob(privateKey)
    const decodedPublic = atob(publicKey)

    assertStringIncludes(decodedPrivate, '-----BEGIN PRIVATE KEY-----')
    assertStringIncludes(decodedPrivate, '-----END PRIVATE KEY-----')
    assertStringIncludes(decodedPublic, '-----BEGIN PUBLIC KEY-----')
    assertStringIncludes(decodedPublic, '-----END PUBLIC KEY-----')
  }
})

Deno.test('generates a genuinely distinct keypair per identity, never reused', async () => {
  const keyPairs = await generateMeshKeyPairs(['billing', 'zanix-admin'])

  assertNotEquals(keyPairs.billing.privateKey, keyPairs['zanix-admin'].privateKey)
  assertNotEquals(keyPairs.billing.publicKey, keyPairs['zanix-admin'].publicKey)
})
