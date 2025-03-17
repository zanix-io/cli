import type { Command } from '@cliffy/command'
import type { ZanixTemplates } from '@zanix/types'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/utils/logger'

function newProjectAction(
  this: Command,
  options: { template: ZanixTemplates },
  projectName = 'my-zanix-project',
) {
  const { template } = options
  const structure = getZanixPaths('app-server', projectName)

  createFilesAndFolders(structure, template)

  saveZanixConfig('app-server', projectName)

  logger.info(
    `Project created sucessfully in the '${projectName}' folder using the '${template}' template.`,
  )
}

export default newProjectAction
