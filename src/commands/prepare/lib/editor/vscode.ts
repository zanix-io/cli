import type { BaseEditorHelperOptions } from 'commands/prepare/lib/typings.ts'

import { createEditorFileConfig } from 'commands/prepare/lib/editor/main.ts'
import { getConfigDir } from '@zanix/helpers'

/**
 * Creates a `VSCode` configuration file (`settings.json`) for the current project.
 * This function generates a configuration file specifically tailored for use with VSCode.
 *
 * @param options The editor helper options
 *   - `baseRoot`: The base root directory where the folder should be created. Defaults to root.
 */
export function createVSCodeConfig(
  options?: BaseEditorHelperOptions,
): Promise<boolean> {
  const config = getConfigDir()?.split('/').pop()
  return createEditorFileConfig(
    { type: 'vscode', ...options },
    (content) => content.replace('$DENO_CONFIG', config || 'deno.json'),
  )
}
