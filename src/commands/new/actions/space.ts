import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/logger'

async function newSpaceAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean; verify?: boolean },
  appName: string = 'my-zanix-space',
) {
  const projectType = 'space'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  try {
    structure = getZanixPaths(projectType, appName, template)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)
  await ensureSpaceScaffoldSideEffects(structure.FOLDER, template)

  await saveZanixConfig(projectType, appName)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [appName, `--project-type=${projectType}`, '-g', '-e'])
  }

  logger.info(
    `Space app created sucessfully in the '${appName}' folder using the '${template}' template.`,
  )
}

export default newSpaceAction
