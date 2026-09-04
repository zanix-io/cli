import { assertEquals, assertStringIncludes } from '@std/assert'
import { renderCredentialsMesh } from 'commands/credentials/mesh/render.ts'

const keyPairs = {
  billing: { privateKey: 'PRI-billing', publicKey: 'PUB-billing' },
  'zanix-admin': { privateKey: 'PRI-zanix-admin', publicKey: 'PUB-zanix-admin' },
  templates: { privateKey: 'PRI-templates', publicKey: 'PUB-templates' },
}

Deno.test('private key printed exactly once, for its own identity only', () => {
  const identities = ['billing', 'zanix-admin', 'templates']
  const output = renderCredentialsMesh(identities, keyPairs)

  for (const id of identities) {
    const pattern = new RegExp(`JWK_PRI_${id}=`, 'g')
    assertEquals(output.match(pattern)?.length, 1, `expected exactly one JWK_PRI_${id} line`)
  }
})

Deno.test('public key printed once per OTHER identity, never for itself', () => {
  const identities = ['billing', 'zanix-admin', 'templates']
  const output = renderCredentialsMesh(identities, keyPairs)

  for (const id of identities) {
    const others = identities.filter((other) => other !== id)

    // Appears exactly (N - 1) times overall.
    const pattern = new RegExp(`JWK_PUB_${id}=`, 'g')
    assertEquals(
      output.match(pattern)?.length,
      others.length,
      `expected JWK_PUB_${id} to appear exactly ${others.length} times`,
    )

    // Each of those repetitions is labeled with a distinct other identity.
    for (const other of others) {
      assertStringIncludes(
        output,
        `# Paste this on "${other}"'s own process — it needs to verify "${id}"'s ` +
          `assertions.\nJWK_PUB_${id}=${keyPairs[id as keyof typeof keyPairs].publicKey}`,
      )
    }

    // Never labeled as needing to be pasted on its own process.
    assertEquals(
      output.includes(`# Paste this on "${id}"'s own process — it needs to verify "${id}"'s`),
      false,
    )
  }
})

Deno.test('SERVICE_PERMISSIONS_<id> printed once per identity, always empty', () => {
  const identities = ['billing', 'zanix-admin']
  const output = renderCredentialsMesh(identities, keyPairs)

  for (const id of identities) {
    const pattern = new RegExp(`SERVICE_PERMISSIONS_${id}=`, 'g')
    assertEquals(output.match(pattern)?.length, 1)
    // The placeholder is genuinely empty — nothing guessed after the `=` (the line ends right
    // there, whether or not this identity's block is the last one in the output).
    const emptyPlaceholder = new RegExp(`SERVICE_PERMISSIONS_${id}=$`, 'm')
    assertEquals(emptyPlaceholder.test(output), true)
  }
})

Deno.test('identities kept in the given order, one block per identity', () => {
  const identities = ['zanix-admin', 'billing']
  const output = renderCredentialsMesh(identities, keyPairs)

  const adminIndex = output.indexOf('==================== zanix-admin ====================')
  const billingIndex = output.indexOf('==================== billing ====================')

  assertEquals(adminIndex > -1 && billingIndex > -1 && adminIndex < billingIndex, true)
})
