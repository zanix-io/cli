import { Commander } from 'cli'
import { registerCredentialsMeshCommand } from 'commands/credentials/mesh/command.ts'
import { registerCredentialsPasswordHashCommand } from 'commands/credentials/password-hash/command.ts'

/**
 * `credentials` command — a parent command for credential tooling. `mesh` (service-to-service,
 * `@zanix/auth`'s credential exchange) and `password-hash` (a single unidirectional password
 * hash, `@zanix/helpers`'s `generateHash()`) are its subcommands; a future one registers here the
 * same way.
 */
export default function credentialsCommand(this: Commander) {
  const cwd = new Commander()

  this.mountGroup('credentials', cwd)
    .description('Credential-generation tooling.')
    .action(() => {
      cwd.throw(
        new Error(
          "You must provide a subcommand for the 'credentials' command (e.g. 'mesh', " +
            "'password-hash').",
        ),
      )
    })

  registerCredentialsMeshCommand(cwd)
  registerCredentialsPasswordHashCommand(cwd)
}
