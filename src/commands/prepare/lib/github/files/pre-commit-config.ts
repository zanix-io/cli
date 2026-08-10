import type { BaseGithubHelperOptions } from 'commands/prepare/lib/typings.ts'
import { createBaseFile } from 'commands/prepare/lib/github/files/base.ts'
import logger from '@zanix/logger'

/**
 * Sets up a `pre-commit-config.yaml` to to execute base hooks using pre-commit-framework.
 *
 * This function generates a pre-commit-config yaml file that runs main base hooks by default.
 *
 * @param options The create hook options.
 *   - `baseRoot`: The base root directory where the folder should be created.
 */
export async function createPreCommitYaml(
  options: Omit<BaseGithubHelperOptions, 'baseFolder'> = {},
): Promise<boolean> {
  const response = await createBaseFile({
    baseFile: 'pre-commit.yaml',
    filename: '.pre-commit-config.yaml',
    ...options,
  })

  // 1. pre-commit install
  const install = await new Deno.Command('pre-commit', {
    args: ['install'],
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
    }).output()
  }

  return response
}
