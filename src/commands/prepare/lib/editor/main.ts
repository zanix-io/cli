import type { BaseEditorHelperOptions, EditorOptions } from 'commands/prepare/lib/typings.ts'

import { capitalize, fileExists, getRootDir } from '@zanix/helpers'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'
import { EDITORS } from 'commands/prepare/lib/constants.ts'
import logger from '@zanix/logger'
import { join } from '@std/path'

/**
 * Base function to create the main editor config file — unlike the docker/github base-file
 * writers (which skip entirely if the target already exists), this one MERGES into an existing
 * config: a shallow `{ ...currentContent, ...configContent }` spread, so the freshly-templated
 * keys win on conflict, but any OTHER key the user already had in their own config file survives
 * untouched.
 */
export async function createEditorFileConfig(
  { type, ...options }: EditorOptions & BaseEditorHelperOptions,
  replaceContentCallback: (content: string) => string = (content) => content,
) {
  const editorName = capitalize(type)

  try {
    // Create content for the pre-commit hook
    let configContent = JSON.parse(
      replaceContentCallback(
        await readFileFromCurrentUrl(
          import.meta.url,
          `./settings/${type}.json`,
        ),
      ),
    )

    const { baseRoot = getRootDir() } = options

    const baseFolder = join(baseRoot, EDITORS[type].FOLDER)

    // Create the directory if it doesn't exist
    await Deno.mkdir(baseFolder, { recursive: true })

    // file dir
    const baseFileDir = `${baseFolder}/${EDITORS[type].FILENAME}`

    if (fileExists(baseFileDir)) {
      const currentContent = JSON.parse(await Deno.readTextFile(baseFileDir))
      configContent = { ...currentContent, ...configContent }
    }

    // Write the config file
    await Deno.writeTextFile(
      baseFileDir,
      JSON.stringify(configContent, null, 2),
    )

    logger.success(`'${editorName}' configuration file created successfully!`)

    return true
  } catch (e) {
    // Re-thrown, never swallowed into `return false` — see `docker/files/base.ts`'s own identical
    // comment for the full reasoning.
    logger.error(
      `'${editorName}' configuration file creation error`,
      e,
      'noSave',
    )

    throw e
  }
}
