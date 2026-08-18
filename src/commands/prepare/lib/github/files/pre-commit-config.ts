import type { BaseGithubHelperOptions } from 'commands/prepare/lib/typings.ts'
import { createBaseFile } from 'commands/prepare/lib/github/files/base.ts'
import { getRootDir } from '@zanix/helpers'
import logger from '@zanix/logger'

/**
 * Sets up a `.pre-commit-config.yaml` to execute base hooks via the
 * [pre-commit](https://pre-commit.com/) framework.
 *
 * Beyond writing the file, this also shells out to the real `pre-commit` binary: `pre-commit
 * install` (wires the framework's own hooks into `.git/hooks`), and — only if that succeeds —
 * `pre-commit autoupdate`. If `pre-commit` isn't installed, `install` fails and this logs a
 * warning instead of throwing; `.pre-commit-config.yaml` is still written either way, just never
 * activated until the binary is installed and `pre-commit install` is run by hand.
 *
 * @param options The create hook options.
 *   - `baseRoot`: The base root directory where the folder should be created.
 */
export async function createPreCommitYaml(
  options: Omit<BaseGithubHelperOptions, 'baseFolder'> = {},
): Promise<boolean> {
  const { baseRoot = getRootDir() } = options

  const response = await createBaseFile({
    baseFile: 'pre-commit.yaml',
    filename: '.pre-commit-config.yaml',
    baseRoot,
  })

  // 1. pre-commit install
  // `cwd` is required here: without it, these commands operate on the process's own working
  // directory instead of `baseRoot`, silently installing hooks into the wrong Git repo.
  const install = await new Deno.Command('pre-commit', {
    args: ['install'],
    cwd: baseRoot,
  }).output()

  if (!install.success) {
    logger.warn(
      'It seems pre-commit is not installed. Please install pre-commit and run the following commands: `pre-commit install` and `pre-commit autoupdate` to properly set up your environment.',
      'noSave',
    )
  } else {
    // 2. pre-commit autoupdate
    await new Deno.Command('pre-commit', {
      args: ['autoupdate'],
      cwd: baseRoot,
    }).output()
  }

  return response
}
