import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/utils/logger'

function newLibraryAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean },
  libraryName = 'my-zanix-library',
) {
  const projectType = 'library'
  const { template, prepare } = options
  const structure = getZanixPaths(projectType, libraryName)

  createFilesAndFolders(structure, template)

  saveZanixConfig(projectType, libraryName)

  if (prepare) {
    this.runCommand('prepare', [libraryName, `--project-type=${projectType}`, '-g', '-e'])
  }

  logger.info(
    `Library created sucessfully in the '${libraryName}' folder using the '${template}' template.`,
  )
}

export default newLibraryAction
