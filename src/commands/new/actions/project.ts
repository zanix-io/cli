import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/utils/logger'

function newProjectAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean },
  projectName = 'my-zanix-project',
) {
  const projectType = 'app-server'
  const { template, prepare } = options
  const structure = getZanixPaths(projectType, projectName)

  createFilesAndFolders(structure, template)

  saveZanixConfig(projectType, projectName)

  if (prepare) {
    this.runCommand('prepare', [projectName, `--project-type=${projectType}`, '-g', '-e'])
  }

  logger.info(
    `Project created sucessfully in the '${projectName}' folder using the '${template}' template.`,
  )
}

export default newProjectAction
