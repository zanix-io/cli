import type { Commander } from 'cli'

import newAppAction from 'commands/new/actions/app.ts'
import newSpaceAction from 'commands/new/actions/space.ts'
import newServerAction from 'commands/new/actions/server.ts'
import newSpacecraftAction from 'commands/new/actions/spacecraft.ts'
import newLibraryAction from 'commands/new/actions/library.ts'
import { baseNewCommand } from 'commands/new/base.ts'

/** 'new' command */
export default function newCommand(this: Commander) {
  baseNewCommand.call(this, {
    app: {
      description:
        'Creates a new `@zanix/app`-based package (a `defineZanixApp()` manifest) with the basic structure of the Zanix framework.',
      optionalArgs: ['app-name'],
      action: newAppAction,
    },
    space: {
      description:
        'Creates a new `@zanix/space` frontend app with the basic structure of the Zanix framework.',
      optionalArgs: ['app-name'],
      action: newSpaceAction,
    },
    server: {
      description:
        'Creates a new server project with default configurations to handle requests and respond with the basic server functionality.',
      optionalArgs: ['server-name'],
      action: newServerAction,
    },
    spacecraft: {
      description:
        'Creates a new full-stack project (`@zanix/space` frontend + server) with the basic structure of the Zanix framework.',
      optionalArgs: ['project-name'],
      action: newSpacecraftAction,
    },
    library: {
      description:
        'Generates the basic structure for a new reusable code library within the Zanix ecosystem.',
      optionalArgs: ['library-name'],
      action: newLibraryAction,
    },
  })
}
