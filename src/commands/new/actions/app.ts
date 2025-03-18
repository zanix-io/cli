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
  const { template, prepare } = options
  const structure = getZanixPaths('app', appName)

  createFilesAndFolders(structure, template)

  saveZanixConfig('app', appName)

  if (prepare) {
    this.runCommand('prepare', [appName, '-g', '-e'])
  }

  logger.info(
    `App created sucessfully in the '${appName}' folder using the '${template}' template.`,
  )
}

export default newAppAction
