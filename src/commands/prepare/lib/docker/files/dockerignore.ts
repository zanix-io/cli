import type { BaseDockerHelperOptions } from 'commands/prepare/lib/typings.ts'

import { createDockerBaseFile } from 'commands/prepare/lib/docker/files/base.ts'

/**
 * Generates a base `.dockerignore` file — keeps the host's own `node_modules`/build artifacts/
 * secrets out of the build context, since the image's own build stage regenerates all of them.
 *
 * @param options The create file options.
 *   - `baseRoot`: The base root directory where the file should be created. Defaults to root.
 */
export function createDockerignoreFile(
  options: BaseDockerHelperOptions = {},
): Promise<boolean> {
  return createDockerBaseFile({
    baseFile: 'dockerignore.base',
    filename: '.dockerignore',
    ...options,
  })
}
