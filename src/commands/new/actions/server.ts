import type { Command } from '@cliffy/command'
import type { ZanixTemplates } from '@zanix/types'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/utils/logger'

function newServerAction(
  this: Command,
  options: { template: ZanixTemplates },
  serverName: string = 'my-zanix-server',
) {
  const { template } = options
  const structure = getZanixPaths('server', serverName)

  createFilesAndFolders(structure, template)

  saveZanixConfig('server', serverName)

  logger.info(
    `Server project created sucessfully in the '${serverName}' folder using the '${template}' template.`,
  )
}

export default newServerAction
