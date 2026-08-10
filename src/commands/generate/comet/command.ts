import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { toKebabCase, toPascalCase } from 'utils/casing.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { cometTemplate } from 'commands/generate/comet/template.ts'

export interface CometPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface CometPlan {
  files: CometPlanFile[]
}

/** Pure planning for a comet: given a name + the target `comets/` folder. */
export function planComet(kebabName: string, pascalName: string, cometsFolder: string): CometPlan {
  return {
    files: [{
      PATH: `${cometsFolder}/${kebabName}.comet.tsx`,
      NAME: `${kebabName}.comet.tsx`,
      content: () => Promise.resolve(cometTemplate(pascalName)),
    }],
  }
}

async function generateCometAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  // Comets are a `@zanix/space` concept — never valid for a plain `server` project, unlike every
  // other existing generator (all backend-only, gated to `['server', 'space-server']`).
  assertProjectType(this, ['space', 'space-server'], 'comet', root)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  const cometsFolder = `${projectRoot}/src/space/comets`

  const { files } = planComet(kebabName, pascalName, cometsFolder)
  const tree: ZanixFolderGenericTree = { FOLDER: cometsFolder, templates: { base: files } }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(`Comet file created successfully in 'comets/${kebabName}.comet.tsx'.`)
}

export default generateCometAction

export function registerCometCommand(cwd: Commander): void {
  cwd.command('comet')
    .description('Generate a selective-hydration Comet shell (<name>.comet.tsx).')
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateCometAction.call(cwd, options, ...args)
    })
}
