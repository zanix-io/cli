import prepareGithubAction from './actions/github.ts'
import prepareEditorAction from './actions/editor.ts'
import prepareDockerAction from './actions/docker.ts'
import { Commander } from 'cli'

/** 'prepare' command */
export default function prepareCommand(this: Commander) {
  const cwd = new Commander()
  this.mountGroup('prepare', cwd)
    .description(
      'Set up the project by initializing Git, configuring hooks, and setting up workflows.',
    )
    .option(
      '-p --project-type <project-type:string>',
      "Specifies the type of project ('library', 'space-server', 'space', 'server', and 'app')",
    )
    .option(
      '--publish [publish:boolean]',
      "Whether '-g/--github' also writes .github/workflows/publish.yml (deno publish, gated on " +
        "ci.yml passing) alongside ci.yml. Defaults to 'true' for --project-type library/app " +
        "(the common case: those two exist specifically to be published) and 'false' for " +
        'server/space/space-server (usually a deployed service, not a published package — ' +
        'defaulting this on would mean deno publish running, and failing, on every push to a ' +
        "repo never registered on JSR). Pass explicitly ('--publish' or '--publish=false') to " +
        'override the default either way — e.g. a space-server that DOES want zero-clone JSR ' +
        "distribution, matching zanix/iam's own real shape.",
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
      '--hooks-engine <engine:string>',
      "Which engine manages the Git hooks: 'native' (this project's own shell scripts, default) or 'framework' (the pre-commit Python framework)",
    )
    .arguments('[root:string]')
    .option(
      '-g --github',
      'Initialize GitHub configuration for the project',
      {
        default: null,
        action: prepareGithubAction.bind(cwd),
      },
    )
    .option(
      '-e --editor [editor:string]',
      'Set up the editor configuration for the project',
      {
        default: null,
        action: prepareEditorAction.bind(cwd),
      },
    )
    .option(
      '-d --docker',
      'Generate a Dockerfile and .dockerignore for containerized deployment',
      {
        default: null,
        action: prepareDockerAction.bind(cwd),
      },
    ).action((options) => {
      if (
        options.editor === undefined && options.github === undefined &&
        options.docker === undefined
      ) {
        cwd.throw(
          new Error(
            "You must provide at least one option for the 'prepare' command.",
          ),
        )
      }
    })
}
