import type { Command } from '@cliffy/command'

import newAppAction from 'commands/new/actions/app.ts'
import newServerAction from 'commands/new/actions/server.ts'
import newProjectAction from 'commands/new/actions/project.ts'
import newLibraryAction from 'commands/new/actions/library.ts'
import { baseNewCommand } from 'commands/new/base.ts'

/** 'new' command */
export default function newCommand(this: Command) {
  baseNewCommand.call(this, {
    app: {
      description: 'Creates a new application with the basic structure of the Zanix framework.',
      optionalArgs: ['app-name'],
      action: newAppAction,
    },
    server: {
      description:
        'Creates a new server project with default configurations to handle requests and respond with the basic server functionality.',
      optionalArgs: ['server-name'],
      action: newServerAction,
    },
    project: {
      description:
        'Creates a new project (app and server) with the basic structure of the Zanix framework.',
      optionalArgs: ['project-name'],
      action: newProjectAction,
    },
    library: {
      description:
        'Generates the basic structure for a new reusable code library within the Zanix ecosystem.',
      optionalArgs: ['library-name'],
      action: newLibraryAction,
    },
  })
}
