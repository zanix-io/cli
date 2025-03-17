import type { Command } from '@cliffy/command'
import type { ZanixTemplates } from '@zanix/types'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from '@zanix/utils/helpers'
import logger from '@zanix/utils/logger'

function newLibraryAction(
  this: Command,
  options: { template: ZanixTemplates },
  libraryName = 'my-zanix-library',
) {
  const { template } = options
  const structure = getZanixPaths('library', libraryName)

  createFilesAndFolders(structure, template)

  saveZanixConfig('library', libraryName)
  logger.info(
    `Library created sucessfully in the '${libraryName}' folder using the '${template}' template.`,
  )
}

export default newLibraryAction
