import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureServerScaffoldSideEffects } from 'commands/new/lib/tree/projects/server.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'

async function newSpacecraftAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean; verify?: boolean },
  projectName = 'my-zanix-spacecraft',
) {
  const projectType = 'space-server'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  try {
    structure = getZanixPaths(projectType, projectName, template)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)
  await ensureServerScaffoldSideEffects(structure.FOLDER, template)
  await ensureSpaceScaffoldSideEffects(structure.FOLDER, template)

  await saveZanixConfig(projectType, projectName)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [projectName, `--project-type=${projectType}`, '-g', '-e'])
  }

  logger.info(
    `Spacecraft created sucessfully in the '${projectName}' folder using the '${template}' template.`,
  )
}

export default newSpacecraftAction
