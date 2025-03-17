import { Command } from '@cliffy/command'
import { readConfig } from '@zanix/utils/helpers'
import { CLI_ALIASES } from 'utils/constants.ts'
import { ZANIX_LOGO } from '@zanix/utils/constants'
import * as commands from './commands/mod.ts'
import logger from '@zanix/utils/logger'

const { name = '@zanix/cli', version = 'latest' } = readConfig()

/**
 * Base commander class
 */
class Commander extends Command {
  constructor() {
    super()
    this.setup().setErrorHandler().setCommands()
  }

  /**
   * Setup the name, aliases and description
   */
  private setup() {
    this.name(name)
      .description(
        `${ZANIX_LOGO}Command-line interface for Zanix framework.`,
      )
      .version(version)

    CLI_ALIASES.map((value) => this.alias(value))

    return this
  }

  /**
   * Set custom error Handler
   */
  private setErrorHandler() {
    return this.error((e, cwd) => {
      cwd.showHelp()
      logger.error(e.message)
      Deno.exit(1)
    }).throwErrors()
  }

  /**
   * Set theavailable commands
   */
  private setCommands() {
    Object.values(commands).forEach((cmd) => {
      cmd.call(this)
    })

    return this
  }
}

const cli = new Commander()

export default cli
