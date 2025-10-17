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
  const projectType = 'server'
  const { template, prepare } = options
  const structure = getZanixPaths(projectType, serverName)

  createFilesAndFolders(structure, template)

  saveZanixConfig(projectType, serverName)

  if (prepare) {
    this.runCommand('prepare', [serverName, `--project-type=${projectType}`, '-g', '-e'])
  }

  logger.info(
    `Server project created sucessfully in the '${serverName}' folder using the '${template}' template.`,
  )
}

export default newServerAction
