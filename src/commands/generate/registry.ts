import type { Commander } from 'cli'

import { registerSeederCommand } from 'commands/generate/seeder/command.ts'
import { registerRepositoryCommand } from 'commands/generate/repository/command.ts'
import { registerHandlerCommand } from 'commands/generate/handler/command.ts'
import { registerRtoCommand } from 'commands/generate/rto/command.ts'
import { registerConnectorCommand } from 'commands/generate/connector/command.ts'
import { registerInteractorCommand } from 'commands/generate/interactor/command.ts'
import { registerJobCommand } from 'commands/generate/job/command.ts'
import { registerDlqProcessorCommand } from 'commands/generate/dlqprocessor/command.ts'
import { registerSubscriberCommand } from 'commands/generate/subscriber/command.ts'
import { registerMiddlewareCommand } from 'commands/generate/middleware/command.ts'
import { registerGlobalMiddlewareCommand } from 'commands/generate/globalmiddleware/command.ts'
import { registerOpenapiCommand } from 'commands/generate/openapi/command.ts'
import { registerGraphqlSchemaCommand } from 'commands/generate/graphql-schema/command.ts'
import { registerCometCommand } from 'commands/generate/comet/command.ts'
import { registerComponentCommand } from 'commands/generate/component/command.ts'
import { registerPageCommand } from 'commands/generate/page/command.ts'
import { registerLayoutCommand } from 'commands/generate/layout/command.ts'
import { registerErrorCommand } from 'commands/generate/error/command.ts'
import { registerLoadingCommand } from 'commands/generate/loading/command.ts'
import { registerNotFoundCommand } from 'commands/generate/not-found/command.ts'

/**
 * Every `zanix generate <artifact>` sub-command, registered here and nowhere else. Adding a new
 * generator means creating its own `<artifact>/command.ts` (exporting a plain
 * `register<Name>Command(cwd)` function) and adding it to this array — `main.ts` never needs to
 * change.
 */
export const generatorRegistry: Array<(cwd: Commander) => void> = [
  registerSeederCommand,
  registerRepositoryCommand,
  registerHandlerCommand,
  registerRtoCommand,
  registerConnectorCommand,
  registerInteractorCommand,
  registerJobCommand,
  registerDlqProcessorCommand,
  registerSubscriberCommand,
  registerMiddlewareCommand,
  registerGlobalMiddlewareCommand,
  registerOpenapiCommand,
  registerGraphqlSchemaCommand,
  registerCometCommand,
  registerComponentCommand,
  registerPageCommand,
  registerLayoutCommand,
  registerErrorCommand,
  registerLoadingCommand,
  registerNotFoundCommand,
]
