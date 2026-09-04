import type { Commander } from 'cli'

import { generateMeshKeyPairs } from 'commands/credentials/mesh/keys.ts'
import { renderCredentialsMesh } from 'commands/credentials/mesh/render.ts'
import { assertValidMeshIdentities } from 'commands/credentials/mesh/validate.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix credentials mesh <id1> <id2> ...`'s real orchestration: validates the given identities
 * (`assertValidMeshIdentities`), generates one real RSA keypair per identity via
 * `generateMeshKeyPairs` (`generateRSAKeys()` from `@zanix/helpers`), and prints the resulting
 * cross-referenced `.env` blocks (`renderCredentialsMesh`) to stdout.
 *
 * **Local-dev/first-integration-setup convenience only — never a production secrets-provisioning
 * path.** This command never writes a file, the same boundary `zanix new`/`zanix generate` already
 * hold for `.env` itself (see `utils/config/base.ts`'s scaffolded `dev` task, which reads `.env` via
 * `--env-file` but never creates one): it only prints text for the operator to paste into each
 * identity's own real secrets store by hand. Real production secrets belong to infra-as-code/
 * secrets-manager tooling — this command exists to save the tedious, error-prone hand
 * cross-referencing of `JWK_PRI_<id>`/`JWK_PUB_<id>` pairs across N separate `.env` files during
 * initial setup/testing of a multi-identity mesh (see `docs/credentials.md`).
 *
 * @param identities The mesh's identity names, in the order given on the command line.
 */
export async function generateCredentialsMeshAction(
  this: Commander,
  _options: unknown,
  ...identities: string[]
): Promise<void> {
  assertValidMeshIdentities(this, identities)

  const keyPairs = await generateMeshKeyPairs(identities)

  // Deliberately bypasses `logger` here — every `logger` method prepends a colored, timestamped
  // header onto the SAME console call as its own first argument, which would corrupt this block's
  // first line for anyone copy-pasting it straight into a real `.env` file. This block's exact
  // text (comments included) is the command's whole output contract; nothing about it may be
  // reformatted.
  // deno-lint-ignore deno-zanix-plugin/no-znx-console
  console.log(renderCredentialsMesh(identities, keyPairs))

  logger.info(
    `Generated a real, matched RSA keypair for ${identities.length} identities — paste the blocks ` +
      "above into each identity's own real secrets store; nothing was written to disk. This is a " +
      'local-dev/first-integration-setup convenience only, not a production secrets-provisioning ' +
      'path.',
  )
}

export default generateCredentialsMeshAction

/**
 * Registers `zanix credentials mesh` under the `credentials` group's own `cwd` — see
 * `commands/credentials/main.ts` for the parent group.
 */
export function registerCredentialsMeshCommand(cwd: Commander): void {
  cwd.command('mesh')
    .description(
      'Generates a real, matched set of RSA keypairs for N cooperating service identities, ' +
        'printing ready-to-paste, correctly-cross-referenced \'.env\' blocks ("JWK_PRI_<id>"/' +
        '"JWK_PUB_<id>"/"SERVICE_PERMISSIONS_<id>") — never writes a file. Local-dev/first-' +
        'integration-setup convenience only, not a production secrets-provisioning path (use real ' +
        'infra-as-code/secrets-manager tooling for that).',
    )
    .arguments('[ids...:string]')
    .action((options, ...ids: string[]) => generateCredentialsMeshAction.call(cwd, options, ...ids))
}
