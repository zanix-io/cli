import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/utils/logger'

function newServerAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean },
  serverName: string = 'my-zanix-server',
) {
  const { template, prepare } = options
  const structure = getZanixPaths('server', serverName)

  createFilesAndFolders(structure, template)

  saveZanixConfig('server', serverName)

  if (prepare) {
    this.runCommand('prepare', [serverName, '-g', '-e'])
  }

  logger.info(
    `Server project created sucessfully in the '${serverName}' folder using the '${template}' template.`,
  )
}

export default newServerAction
