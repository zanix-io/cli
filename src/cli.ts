import { readModuleConfig } from '@zanix/utils/helpers'
import { ZANIX_LOGO } from '@zanix/utils/constants'
import { Command, type ErrorHandler } from '@cliffy/command'
import * as commands from './commands/mod.ts'
import logger, { Logger } from '@zanix/utils/logger'

const { name = '@zanix/cli', version = 'latest' } = await readModuleConfig(
  import.meta.url,
)

/** Walks up `_parent` links to the outermost command, however many pseudo-parents deep `cmd` is. */
function getRootCommand(cmd: Command): Command {
  let root = cmd
  while (root.getParent()) root = root.getParent() as unknown as Command
  return root
}

/**
 * Base commander class
 */
class Commander extends Command {
  /**
   * The same function passed to `.error()` below, kept around so `mountGroup` can re-apply it to
   * every pseudo-parent it mounts (see that method's own doc for why).
   */
  private errorHandlerFn?: ErrorHandler

  /**
   * Setup the name, aliases and description
   */
  public setup() {
    new Logger({ storage: false }) // Define instante for not saving logs
    this.name(name)
      .description(
        `${ZANIX_LOGO}Command-line interface for Zanix framework.`,
      )
      .version(version)

    return this
  }

  /**
   * Set custom error Handler
   */
  public setErrorHandler() {
    this.errorHandlerFn = (e, cwd) => {
      cwd.showHelp()
      delete e.stack
      logger.error(e.message)
      Deno.exit(1)
    }

    return this.error(this.errorHandlerFn).throwErrors()
  }

  /**
   * Mounts a pre-built pseudo-parent command (e.g. `new`/`generate`/`space`'s own `cwd`, which
   * groups that family's leaf commands) and re-applies this command's error handler onto it.
   *
   * cliffy's own error-handler lookup only checks one level up the parent chain
   * (`this.errorHandler ?? this._parent?.errorHandler`, not the full chain — see
   * `@cliffy/command@1.0.0-rc.8`'s `command.ts:1165-1167`), while `shouldThrowErrors()` walks the
   * whole chain. So a leaf command mounted two levels below `cli` (e.g. `cli -> new -> space`)
   * never finds `cli`'s own handler on its own — only the pseudo-parent directly above it does.
   * Setting the same handler on every pseudo-parent keeps it reachable from any leaf beneath it,
   * however many of these groups end up nested.
   */
  public mountGroup(name: string, group: Commander): this {
    const result = this.command(name, group) as unknown as this

    if (this.errorHandlerFn) group.error(this.errorHandlerFn).throwErrors()

    return result
  }

  /**
   * Set the available commands
   */
  public setCommands() {
    Object.values(commands).forEach((cmd) => {
      cmd.call(this)
    })

    return this
  }

  /**
   * Run a specific Command
   *
   * Looks the named command up from the true root (`cli`), not just one level up: `this` here is
   * whatever leaf command's action called it, e.g. `space`, itself mounted under a pseudo-parent
   * (`new`) that is in turn mounted under `cli` — `command` (e.g. `prepare`) is a sibling of that
   * pseudo-parent, not of the leaf itself, so a single `getParent()` hop lands one level too
   * shallow.
   *
   * @param command - The name of the registered sub-command to run
   * @param args - The arguments to pass to the sub-command's parser
   */
  public runCommand(command: string, args?: string[]) {
    return getRootCommand(this).getCommand(command)?.parse(args)
  }
}

const cli = new Commander().setup().setErrorHandler().setCommands()

export default cli

export { Commander }
