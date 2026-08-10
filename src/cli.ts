import { readModuleConfig } from '@zanix/utils/helpers'
import { ZANIX_LOGO } from '@zanix/utils/constants'
import { Command } from '@cliffy/command'
import * as commands from './commands/mod.ts'
import logger, { Logger } from '@zanix/utils/logger'

const { name = '@zanix/cli', version = 'latest' } = await readModuleConfig(import.meta.url)

/**
 * Base commander class
 */
class Commander extends Command {
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
    return this.error((e, cwd) => {
      cwd.showHelp()
      delete e.stack
      logger.error(e.message)
      Deno.exit(1)
    }).throwErrors()
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
   * @param command - The name of the registered sub-command to run
   * @param args - The arguments to pass to the sub-command's parser
   */
  public runCommand(command: string, args?: string[]) {
    const parent = this.getParent() as Command | undefined
    return parent?.getCommand(command)?.parse(args)
  }
}

const cli = new Commander().setup().setErrorHandler().setCommands()

export default cli

export { Commander }
