import type { WorkflowOptions, WorkFlowTypes } from 'commands/prepare/lib/typings.ts'

import { capitalize, fileExists, getRootDir } from '@zanix/helpers'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'
import { GITHUB_WORKFLOW_FOLDER } from 'commands/prepare/lib/constants.ts'
import logger from '@zanix/logger'
import { join } from '@std/path'

/**
 * Base function to create a YAML workflow file.
 *
 * @param options - Workflow creation options.
 *   - `filename`: Which single workflow template to use (`'ci'` or `'publish'`) — one call writes
 *     one file. Falsy skips creation entirely (with a warning); kept for robustness against a
 *     future caller that hasn't resolved a concrete template yet, not exercised by
 *     {@link createGitWorkflows}'s own real calls, which always pass a concrete `filename`.
 *   - `baseFolder`: Where the `.yml` file is written. Defaults to `GITHUB_WORKFLOW_FOLDER`.
 *   - `baseRoot`: The project root. Defaults to `getRootDir()`.
 */
export async function createWorkflow(
  options: WorkflowOptions & {
    filename: WorkFlowTypes
  },
  replaceContentCallback: (content: string) => string = (content) => content,
) {
  if (!options.filename) {
    logger.warn(
      'No workflow YAML file found for this project, skipping creation.',
      'noSave',
    )
    return false
  }

  const {
    baseFolder = GITHUB_WORKFLOW_FOLDER,
    baseRoot = getRootDir(),
    filename: yml,
  } = options

  const mainYamls = capitalize(yml)
  const dir = join(baseRoot, baseFolder)

  try {
    // Create content for the pre-commit hook
    const hookContent = await readFileFromCurrentUrl(
      import.meta.url,
      `./yamls/${yml}.base.yml`,
    )

    // Create the .github/workflow directory if it doesn't exist
    await Deno.mkdir(dir, { recursive: true })

    // file dir
    const baseFileDir = `${dir}/${yml}.yml`

    if (fileExists(baseFileDir)) {
      logger.warn(
        `'${mainYamls}' YAML already exists, skipping creation.`,
        'noSave',
      )
      return false
    }

    // Write the YAML file
    await Deno.writeTextFile(baseFileDir, replaceContentCallback(hookContent))

    logger.success(`'${mainYamls}' YAML created successfully!`)

    return true
  } catch (e) {
    // Re-thrown, never swallowed into `return false` — see `docker/files/base.ts`'s own identical
    // comment for the full reasoning: swallowing this would make a real write failure
    // indistinguishable from the benign "already exists" skip above, and would never reach the
    // action's own `this.throw`.
    logger.error(`'${mainYamls}' YAML creation error in '${dir}'`, e, 'noSave')

    throw e
  }
}
