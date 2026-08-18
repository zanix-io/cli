import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { interactorTemplate } from 'commands/generate/interactor/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface InteractorPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface InteractorPlan {
  files: InteractorPlanFile[]
}

/** Pure planning for an interactor: given a name + the target `interactors/` folder. */
export function planInteractor(
  kebabName: string,
  pascalName: string,
  interactorsFolder: string,
): InteractorPlan {
  return {
    files: [{
      PATH: `${interactorsFolder}/${kebabName}.interactor.ts`,
      NAME: `${kebabName}.interactor.ts`,
      content: () => Promise.resolve(interactorTemplate(pascalName)),
    }],
  }
}

async function generateInteractorAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'interactor', root)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  const interactorsFolder = `${projectRoot}/src/server/interactors`

  const { files } = planInteractor(kebabName, pascalName, interactorsFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: interactorsFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/server')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Interactor file created successfully in 'interactors/${kebabName}.interactor.ts'.`,
  )
}

export default generateInteractorAction

export function registerInteractorCommand(cwd: Commander): void {
  cwd.command('interactor')
    .description('Generate an interactor/service shell (<name>.interactor.ts).')
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateInteractorAction.call(cwd, options, ...args)
    })
}
