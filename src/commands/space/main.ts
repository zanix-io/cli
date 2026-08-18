import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'

/**
 * 'space' command — a parent command for `@zanix/space`-specific tooling, same shape as
 * `generate`'s own parent/subcommand pattern (`commands/generate/main.ts`). `dev`/`build` are its
 * subcommands; a future one registers here the same way.
 */
export default function spaceCommand(this: Commander) {
  const cwd = new Commander()

  this.mountGroup('space', cwd)
    .description('Tooling specific to @zanix/space frontend projects.')
    .action(() => {
      cwd.throw(
        new Error(
          "You must provide a subcommand for the 'space' command (e.g. 'dev'/'build').",
        ),
      )
    })

  registerSpaceDevCommand(cwd)
  registerSpaceBuildCommand(cwd)
}
