import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { layoutTemplate } from 'commands/generate/layout/template.ts'

async function generateLayoutAction(
  this: Commander,
  options: unknown,
  routePath: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'layout', root)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // Same reasoning as `page/command.ts`: the route path is written verbatim as the folder
  // structure, never reshaped — it determines which segment this layout wraps.
  const layoutFolder = `${projectRoot}/src/space/routes/${routePath}`
  const pascalName = pascalNameFromRoutePath(routePath)

  const tree: ZanixFolderGenericTree = {
    FOLDER: layoutFolder,
    templates: {
      base: [
        {
          PATH: `${layoutFolder}/layout.tsx`,
          NAME: 'layout.tsx',
          content: () => Promise.resolve(layoutTemplate(pascalName)),
        },
      ],
    },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(`Layout file created successfully in 'routes/${routePath}/layout.tsx'.`)
}

export default generateLayoutAction

export function registerLayoutCommand(cwd: Commander): void {
  cwd.command('layout')
    .description(
      "Generate a segment layout (routes/<route-path>/layout.tsx) — e.g. 'products'.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<route-path:string> [root:string]')
    .action((options, ...args) => {
      return generateLayoutAction.call(cwd, options, ...args)
    })
}
