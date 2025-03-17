import { Command } from '@cliffy/command'
import prepareGithubAction from './actions/github.ts'
import prepareEditorAction from './actions/editor.ts'

/** 'prepare' command */
export default function prepareCommand(this: Command) {
  const cwd = new Command()
  this.command('prepare', cwd)
    .description(
      'Set up the project by initializing Git, configuring hooks, and setting up workflows.',
    )
    .option(
      '-p --project-type <project-type:string>',
      "Specifies the type of project ('library', 'app-server', 'app', and 'server')",
    )
    .option(
      '--lint-files <lint-files:string>',
      'Specifies the file extensions to include for Git hooks that run a linter. Use file modular extensions (e.g., js,ts,tsx) to target specific file types.',
    )
    .option(
      '--fmt-files <fmt-files:string>',
      'Specifies the file extensions to include for Git hooks that run a Deno fmt. Use file extensions (e.g., js,md,ts,json) to target specific file types.',
    )
    .option(
      '-g --github',
      'Initialize GitHub configuration for the project',
      {
        default: null,
        action: prepareGithubAction.bind(cwd),
      },
    )
    .option('-e --editor [editor:string]', 'Set up the editor configuration for the project', {
      default: null,
      action: prepareEditorAction.bind(cwd),
    }).action((options) => {
      if (options.editor === undefined && options.github === undefined) {
        cwd.throw(new Error("You must provide at least one option for the 'prepare' command."))
      }
    })
}
