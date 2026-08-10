import type { WorkflowOptions, WorkFlowTypes } from 'commands/prepare/lib/typings.ts'

import { capitalize, fileExists, getRootDir } from '@zanix/helpers'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'
import { GITHUB_WORKFLOW_FOLDER } from 'commands/prepare/lib/constants.ts'
import logger from '@zanix/logger'
import { join } from '@std/path'

/** Base function to create a YAML workflow file */
export async function createWorkflow(
  options: WorkflowOptions & {
    filename: WorkFlowTypes
  },
  replaceContentCallback: (content: string) => string = (content) => content,
) {
  if (!options.filename) {
    logger.warn('No workflow YAML file found for this project, skipping creation.', 'noSave')
    return false
  }

  const { baseFolder = GITHUB_WORKFLOW_FOLDER, baseRoot = getRootDir(), filename: yml } = options

  const mainYamls = capitalize(yml)
  const dir = join(baseRoot, baseFolder)

  try {
    // Create content for the pre-commit hook
    const hookContent = await readFileFromCurrentUrl(import.meta.url, `./yamls/${yml}.base.yml`)

    // Create the .github/workflow directory if it doesn't exist
    await Deno.mkdir(dir, { recursive: true })

    // file dir
    const baseFileDir = `${dir}/${yml}.yml`

    if (fileExists(baseFileDir)) {
      logger.warn(`'${mainYamls}' YAML already exists, skipping creation.`, 'noSave')
      return false
    }

    // Write the YAML file
    await Deno.writeTextFile(baseFileDir, replaceContentCallback(hookContent))

    logger.success(`'${mainYamls}' YAML created successfully!`)

    return true
  } catch (e) {
    logger.error(`'${mainYamls}' YAML creation error in '${dir}'`, e, 'noSave')

    return false
  }
}
