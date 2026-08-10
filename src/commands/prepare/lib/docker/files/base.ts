import type { BaseDockerHelperOptions } from 'commands/prepare/lib/typings.ts'

import { fileExists, getRootDir } from '@zanix/helpers'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'
import logger from '@zanix/logger'
import { join } from '@std/path'

/**
 * Generates a base file for Docker packaging (`Dockerfile`/`.dockerignore`) — a local writer, not
 * shared with `github/files/base.ts`'s `createBaseFile` (which has no substitution hook at all) or
 * `github/workflows/main.ts`'s `createWorkflow` (which is hardcoded to `.github/workflows`/`.yml`).
 * `readFileFromCurrentUrl(import.meta.url, ...)` resolves relative to the module that CALLS it, not
 * the one that defines it — `github`/`editor` already duplicate their own writer for the identical
 * reason, this follows the same established convention rather than trying to share one across
 * domains.
 *
 * @param options The create file options.
 *   - `baseRoot`: The base root directory where the file should be created. Defaults to root.
 *   - `baseFile`: The base file (under `./base/`) to read the template from.
 *   - `filename`: The file name for the creation (e.g. `Dockerfile`, `.dockerignore`).
 * @param replaceContentCallback Optional content transform applied before writing (placeholder
 * substitution) — same shape as `createWorkflow`'s own optional callback.
 */
export async function createDockerBaseFile(
  options: BaseDockerHelperOptions & { baseFile: string; filename: string },
  replaceContentCallback: (content: string) => string = (content) => content,
): Promise<boolean> {
  const { baseRoot = getRootDir(), baseFile, filename } = options
  try {
    const fileContent = await readFileFromCurrentUrl(import.meta.url, join('base', baseFile))

    if (baseRoot) {
      await Deno.mkdir(baseRoot, { recursive: true })
    }

    const fileDir = join(baseRoot, filename)

    if (fileExists(fileDir)) {
      logger.warn(`'${filename}' file already exists, skipping creation.`, 'noSave')

      return false
    }

    await Deno.writeTextFile(fileDir, replaceContentCallback(fileContent))

    logger.success(`'${filename}' file created successfully!`)

    return true
  } catch (e) {
    logger.error(`'${filename}' file creation error in '${baseRoot}'`, e, 'noSave')

    return false
  }
}
