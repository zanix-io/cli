import type { MeshKeyPair } from 'commands/credentials/mesh/render.ts'

import { generateRSAKeys } from '@zanix/helpers'

/**
 * Generates one real RSA keypair per identity via `generateRSAKeys()` (`@zanix/helpers`), then
 * base64-encodes both halves — the exact value shape `@zanix/auth`'s service-credential exchange
 * expects for `JWK_PRI_<id>`/`JWK_PUB_<id>` (`btoa(privateKey)`/`btoa(publicKey)`, never the raw
 * multi-line PEM). `generateRSAKeys()`'s default options already produce a PKCS#8 private key/SPKI public key
 * pair, the only format `@zanix/auth`'s `crypto.subtle.importKey` call accepts — no options need
 * overriding here.
 *
 * Every identity gets its OWN independently generated keypair — this never reuses a key across
 * identities, since `identities` here is only ever called with a list already validated as
 * duplicate-free (see `validate.ts`'s own `assertValidMeshIdentities`, which throws on any
 * repeated identity before this function ever runs).
 *
 * @param identities The mesh's identity names, in the order `zanix credentials mesh` received them.
 * @returns Each identity's own keypair, keyed by identity name.
 */
export async function generateMeshKeyPairs(
  identities: string[],
): Promise<Record<string, MeshKeyPair>> {
  const generated = await Promise.all(
    identities.map(async (id) => {
      const { privateKey, publicKey } = await generateRSAKeys()
      return [id, { privateKey: btoa(privateKey), publicKey: btoa(publicKey) }] as const
    }),
  )

  return Object.fromEntries(generated)
}
