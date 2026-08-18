import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { errorTemplate } from 'commands/generate/error/template.ts'

async function generateErrorAction(
  this: Commander,
  options: unknown,
  routePath: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'error', root)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // Same reasoning as `layout/command.ts`: the route path is written verbatim as the folder
  // structure, never reshaped — it determines which segment this error boundary wraps.
  const errorFolder = `${projectRoot}/src/space/routes/${routePath}`
  const pascalName = pascalNameFromRoutePath(routePath)

  const tree: ZanixFolderGenericTree = {
    FOLDER: errorFolder,
    templates: {
      base: [
        {
          PATH: `${errorFolder}/error.tsx`,
          NAME: 'error.tsx',
          content: () => Promise.resolve(errorTemplate(pascalName)),
        },
      ],
    },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Error boundary file created successfully in 'routes/${routePath}/error.tsx'.`,
  )
}

export default generateErrorAction

export function registerErrorCommand(cwd: Commander): void {
  cwd.command('error')
    .description(
      "Generate a segment error boundary (routes/<route-path>/error.tsx) — e.g. 'products'.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<route-path:string> [root:string]')
    .action((options, ...args) => {
      return generateErrorAction.call(cwd, options, ...args)
    })
}
