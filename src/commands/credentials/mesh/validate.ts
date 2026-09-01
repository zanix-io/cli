import type { Commander } from 'cli'

/**
 * Matches the same shape a real `serviceId` already takes elsewhere in this ecosystem (e.g.
 * `zanix-admin`, `billing` in `@zanix/auth`'s own `JWK_PUB_<serviceId>` examples):
 * letters, digits, `_`, or `-`. Deliberately excludes `=`, `#`, whitespace, and newlines — every one
 * of those would break the resulting `KEY_<id>=value` `.env` line's own shape once pasted.
 */
const VALID_MESH_IDENTITY = /^[A-Za-z0-9_-]+$/

/**
 * Guards `zanix credentials mesh <id1> <id2> ...`'s raw identity arguments before any RSA keypair
 * is generated for them. Routed through `cwd.throw` (Cliffy's `throwErrors()`-configured error
 * pipeline, same convention every other generator's own `assert*` helper in this package uses), so
 * an invalid mesh surfaces as a clear error + exit 1 instead of a confusing or malformed printed
 * `.env` block.
 *
 * A mesh of fewer than 2 identities has nothing to cross-reference — `JWK_PUB_<id>`/
 * `SERVICE_PERMISSIONS_<id>` only exist to let one identity verify ANOTHER's assertions, so a
 * single identity is rejected the same way a "mesh" of one node would be rejected anywhere else.
 *
 * @param cwd The command instance (`this` inside `generateCredentialsMeshAction`), used to route a
 * failure through Cliffy's own error pipeline via `cwd.throw`.
 * @param identities The raw identity names `zanix credentials mesh` received, in the order given.
 * @throws {Error} If fewer than 2 identities are given, the same identity is repeated, or an
 * identity doesn't match {@link VALID_MESH_IDENTITY}.
 */
export function assertValidMeshIdentities(cwd: Commander, identities: string[]): void {
  if (identities.length < 2) {
    cwd.throw(
      new Error(
        `'zanix credentials mesh' needs at least 2 cooperating identities, got ` +
          `${identities.length} — a mesh of fewer than 2 has nothing to cross-reference. Example: ` +
          `'zanix credentials mesh billing zanix-admin'.`,
      ),
    )
    return
  }

  const seen = new Set<string>()

  for (const id of identities) {
    if (seen.has(id)) {
      cwd.throw(
        new Error(
          `Duplicate identity "${id}" — every identity in a mesh must be unique.`,
        ),
      )
      return
    }
    seen.add(id)

    if (!VALID_MESH_IDENTITY.test(id)) {
      cwd.throw(
        new Error(
          `Invalid identity "${id}" — it must match ${VALID_MESH_IDENTITY} (letters, digits, "_", ` +
            `or "-" only), so it can be safely appended to "JWK_PRI_"/"JWK_PUB_"/` +
            `"SERVICE_PERMISSIONS_" without breaking the resulting '.env' line.`,
        ),
      )
      return
    }
  }
}
