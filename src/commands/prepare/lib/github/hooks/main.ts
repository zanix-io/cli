import type { HookOptions } from 'commands/prepare/lib/typings.ts'

import { capitalize, fileExists, folderExists, getRelativePath, getRootDir } from '@zanix/helpers'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'
import { GIT_HOOKS_FOLDER, GITHUB_HOOKS_FOLDER } from 'commands/prepare/lib/constants.ts'
import logger from '@zanix/logger'
import { join } from '@std/path'

let baseGitHooksFolder: string

/** Base git init function — also sets the module-level `baseGitHooksFolder` (below), which
 * `createHook` later reads and explicitly errors on if it was never set (i.e. if `gitInitialization`
 * was never called first). */
export async function gitInitialization(baseRoot: string = getRootDir()) {
  const gitFolder = join(baseRoot, GIT_HOOKS_FOLDER)

  if (!folderExists(gitFolder)) {
    logger.warn(
      `${GIT_HOOKS_FOLDER} directory does not exist. Initializing Git repository...`,
      'noSave',
    )

    // Execute `git init` for initializing the repo if does not exist.
    const gitInit = new Deno.Command('git', {
      args: ['init', baseRoot],
    })

    const gitInitResult = await gitInit.output()
    if (!gitInitResult.success) {
      throw new Error(
        'Git initialization failed. Please check your Git installation and try again `git init` command.',
      )
    }
  }

  baseGitHooksFolder = gitFolder

  return baseGitHooksFolder
}

/**
 * Base function to create a hook.
 *
 * @param options - Hook creation options.
 *   - `baseFolder`: Where the real `.sh` script itself is written. Defaults to
 *     `GITHUB_HOOKS_FOLDER`.
 *   - `filename`: Which hook to create — `'pre-commit'` or `'pre-push'`.
 *   - `createLink`: Whether to symlink the written script into `.git/hooks`. Defaults to `true`;
 *     `prepareGithub` forces this to `false` when the pre-commit framework is also being set up,
 *     so the script still exists but Git never runs it (see `prepareGithub`'s own doc).
 *   - `baseRoot`: The project root. Defaults to `getRootDir()`.
 */
export async function createHook(
  options: HookOptions & {
    filename: 'pre-commit' | 'pre-push'
  },
  replaceContentCallback: (content: string) => string = (content) => content,
) {
  const {
    baseFolder = GITHUB_HOOKS_FOLDER,
    filename: script,
    createLink = true,
    baseRoot = getRootDir(),
  } = options
  const mainScript = capitalize(script)
  const dir = join(baseRoot, baseFolder)

  try {
    // Create content for the pre-commit hook
    const hookContent = await readFileFromCurrentUrl(
      import.meta.url,
      `./scripts/${script}.base.sh`,
    )

    // Create the .github/hooks directory if it doesn't exist
    await Deno.mkdir(dir, { recursive: true })

    // file dir
    const baseFileDir = `${dir}/${script}`

    if (fileExists(baseFileDir)) {
      logger.warn(
        `${mainScript} file already exists, skipping creation.`,
        'noSave',
      )

      return false
    }

    // Write the pre-commit hook file
    await Deno.writeTextFile(baseFileDir, replaceContentCallback(hookContent))

    // Grant execute permissions to the pre-commit file
    const chmod = new Deno.Command('chmod', {
      args: ['+x', baseFileDir],
    })

    const chmodResult = await chmod.output()

    if (!chmodResult.success) {
      throw new Error(
        'chmod command failed. Please check your folder permissions and try again.',
      )
    }

    if (!baseGitHooksFolder) {
      throw new Error(
        'Please verify your Git initialization and try running the znx prepare command again.',
      )
    }

    const fileHook = join(baseGitHooksFolder, script)

    if (createLink) {
      // Create a symbolic link in .git/hooks. `getRelativePath(to, from)` treats `fileHook`'s own
      // filename as an extra path segment, over-counting one `../` in the result — stripping
      // exactly one leading `../` compensates for that (verified against `@zanix/helpers`'
      // `getRelativePath` — a real fix, not defensive filler for a case that can't happen).
      const ln = new Deno.Command('ln', {
        args: [
          '-s',
          getRelativePath(baseFileDir, fileHook).replace(/^\.\.\//, ''),
          fileHook,
        ],
      })

      const lnResult = await ln.output()

      if (!lnResult.success) {
        throw new Error(
          'Symbolic link creation failed. Please check your Git hooks folder, remove current file and try again.',
        )
      }
    }

    logger.success(`'${mainScript}' hook created successfully!`)

    return true
  } catch (e) {
    logger.error(
      `'${mainScript}' hook creation error in '${dir}'`,
      e,
      'noSave',
    )

    return false
  }
}
