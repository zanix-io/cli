import type { PreCommitHookOptions } from 'commands/prepare/lib/typings.ts'

import { createHook } from 'commands/prepare/lib/github/hooks/main.ts'

/**
 * Sets up a `pre-commit` hook to automatically lint and format staged files before they are committed to the `Git` repository.
 *
 * This function generates a pre-commit hook that runs `deno fmt` and `deno lint` on the staged files with the specified file type(s).
 * It will also add the necessary permissions to the hook and create a symbolic link to `.git/hooks/pre-commit`.
 *
 * @param options The create hook options.
 *   - `baseFolder`: The folder name where the workflow file should be created.
 *   - `baseRoot`: The base root directory where the folder should be created.
 *   - `createLink`: A flag indicating whether a symbolic link should be created in the GitHub hooks directory.
 *   - `filePatterns` - The filePatterns property is an optional configuration object that defines the file patterns for linting and formatting operations.
 *                   Defaults to `{lint: ['ts', 'tsx', 'js', 'jsx'], fmt: ['ts', 'tsx', 'js', 'jsx', 'md', 'json']}` if not provided.
 */
export function createPreCommitHook(
  options: PreCommitHookOptions,
): Promise<boolean> {
  const filename = 'pre-commit'
  const {
    filePatterns: {
      lint = ['ts', 'tsx', 'js', 'jsx'],
      fmt = [...lint, 'md', 'json'],
    } = {},
    ...opts
  } = options

  return createHook(
    { filename, ...opts },
    (content) => {
      content = content.replace('FILE_FMT_EXTENSIONS', fmt.join('|'))
      return content.replace('FILE_LINT_EXTENSIONS', lint.join('|'))
    },
  )
}
