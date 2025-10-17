import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/logger'

function newAppAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean },
  appName: string = 'my-zanix-app',
) {
  const projectType = 'app'
  const { template, prepare } = options
  const structure = getZanixPaths(projectType, appName)

  createFilesAndFolders(structure, template)

  saveZanixConfig(projectType, appName)

  if (prepare) {
    this.runCommand('prepare', [appName, `--project-type=${projectType}`, '-g', '-e'])
  }

  logger.info(
    `App created sucessfully in the '${appName}' folder using the '${template}' template.`,
  )
}

export default newAppAction
