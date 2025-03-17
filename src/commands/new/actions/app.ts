import type { Command } from '@cliffy/command'
import type { ZanixTemplates } from '@zanix/types'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/logger'

function newAppAction(
  this: Command,
  options: { template: ZanixTemplates },
  appName: string = 'my-zanix-app',
) {
  const { template } = options
  const structure = getZanixPaths('app', appName)

  createFilesAndFolders(structure, template)

  saveZanixConfig('app', appName)
  logger.info(
    `App created sucessfully in the '${appName}' folder using the '${template}' template.`,
  )
}

export default newAppAction
