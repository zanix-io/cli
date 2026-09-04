import type { HookOptions } from 'commands/prepare/lib/typings.ts'

import { createHook } from 'commands/prepare/lib/github/hooks/main.ts'

/**
 * Sets up a `pre-push` hook to automatically run tests before pushing changes to the `Git` repository.
 *
 * This function generates a pre-push hook that runs `deno test`.
 * It will also add the necessary permissions to the hook and create a symbolic link to `.git/hooks/pre-push`.
 *
 * @param options The create hook options.
 *   - `baseFolder`: The folder name where the workflow file should be created.
 *   - `baseRoot`: The base root directory where the folder should be created.
 *   - `createLink`: A flag indicating whether a symbolic link should be created in the GitHub hooks directory.
 */
export function createPrePushHook(
  options: HookOptions = {},
): Promise<boolean> {
  const filename = 'pre-push'

  return createHook({ filename, ...options })
}
