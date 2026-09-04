/**
 * One identity's generated RSA keypair, both halves already base64-encoded PEM — the exact
 * `JWK_PRI_<id>`/`JWK_PUB_<id>` value shape `@zanix/auth`'s service-credential exchange expects
 * (`btoa(privateKey)`/`btoa(publicKey)`, never the raw multi-line PEM).
 */
export interface MeshKeyPair {
  /** Base64-encoded PKCS#8 private key — pastes into `JWK_PRI_<id>` on `id`'s own process only. */
  privateKey: string
  /** Base64-encoded SPKI public key — pastes into `JWK_PUB_<id>` on every process verifying `id`. */
  publicKey: string
}

/**
 * Pure formatting for `zanix credentials mesh`: given the mesh's identities (in the order they were
 * passed on the command line) and each one's already-generated keypair, returns the exact,
 * ready-to-paste text block this command prints to stdout. Takes no dependency on
 * `crypto.subtle`/`@zanix/helpers` itself, so it's testable with fixed, fake key strings instead of
 * real generated keys — the real generation lives in `keys.ts`, kept separate the same way every
 * other generator in this package splits pure planning from its own I/O.
 *
 * One block per identity, in the order it was passed. Each block prints:
 * - `JWK_PRI_<id>` exactly once — labeled for `id`'s own process only, never repeated elsewhere in
 *   the output.
 * - `JWK_PUB_<id>` once per OTHER identity in the mesh (never once for `id` itself) — each
 *   repetition individually labeled with which other process it belongs on, since a real mesh of
 *   3+ identities can otherwise make it easy to paste the same public key onto the wrong process.
 * - `SERVICE_PERMISSIONS_<id>=` as an empty placeholder, exactly once — deliberately never
 *   guessed. Per `@zanix/auth`'s own service-credential exchange, granted
 *   permissions come only from this operator-configured env var, never from anything a caller's own
 *   assertion requests — there is no safe default this command could fill in on the operator's
 *   behalf.
 *
 * @param identities The mesh's identity names, in the order `zanix credentials mesh` received them.
 * @param keyPairs Each identity's own generated keypair, keyed by identity name.
 * @returns The full, ready-to-paste text — every identity's block separated by a blank line.
 */
export function renderCredentialsMesh(
  identities: string[],
  keyPairs: Record<string, MeshKeyPair>,
): string {
  const blocks = identities.map((id) => {
    const { privateKey, publicKey } = keyPairs[id]
    const others = identities.filter((other) => other !== id)

    const publicKeyLines = others.map((other) =>
      [
        `# Paste this on "${other}"'s own process — it needs to verify "${id}"'s assertions.`,
        `JWK_PUB_${id}=${publicKey}`,
      ].join('\n')
    ).join('\n\n')

    return [
      `# ==================== ${id} ====================`,
      `# Paste this ONLY on "${id}"'s own process — never share it.`,
      `JWK_PRI_${id}=${privateKey}`,
      '',
      publicKeyLines,
      '',
      `# Operator policy decision — no tool can safely infer this. Fill in the permissions "${id}"`,
      `# is granted, on every process where "JWK_PUB_${id}" above is pasted (see`,
      `# @zanix/auth's service-credential exchange: granted permissions come only from this env`,
      `# var, never from the caller's own assertion).`,
      `SERVICE_PERMISSIONS_${id}=`,
    ].join('\n')
  })

  return blocks.join('\n\n')
}
