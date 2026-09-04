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
 * `pre-commit autoupdate`. `install` can fail two different ways, and both log a warning instead
 * of throwing: a non-zero exit (`pre-commit` is on `PATH` but the command itself failed) logs the
 * "please install pre-commit" warning, same as the binary being entirely absent from `PATH`
 * (`Deno.errors.NotFound` at spawn time, caught explicitly so it never propagates as a raw,
 * uncaught rejection); any OTHER spawn-time error (e.g. permission denied) logs a distinct warning
 * naming the real error instead, since "install pre-commit" wouldn't fix a different underlying
 * problem. `.pre-commit-config.yaml` is still written either way, just never activated until the
 * binary is installed/fixed and `pre-commit install` is run by hand.
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
  // The spawn itself (not just a non-zero exit) can reject — e.g. `Deno.errors.NotFound` when the
  // `pre-commit` binary isn't on `PATH` at all — so this is wrapped in its own try/catch rather
  // than relying on `install.success`, which only ever reflects a *successful* spawn that then
  // exited non-zero.
  let install: Deno.CommandOutput | undefined
  let unexpectedSpawnError = false

  try {
    install = await new Deno.Command('pre-commit', {
      args: ['install'],
      cwd: baseRoot,
    }).output()
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Binary genuinely absent from `PATH` — the generic "please install pre-commit" warning
      // below is accurate, fall through to it instead of duplicating it here.
    } else {
      unexpectedSpawnError = true
      logger.warn(
        `Failed to run \`pre-commit install\`: ${
          error instanceof Error ? error.message : String(error)
        }. Please resolve this, then run \`pre-commit install\` and \`pre-commit autoupdate\` by ` +
          'hand to properly set up your environment.',
        'noSave',
      )
    }
  }

  if (!install?.success && !unexpectedSpawnError) {
    logger.warn(
      'It seems pre-commit is not installed. Please install pre-commit and run the following commands: `pre-commit install` and `pre-commit autoupdate` to properly set up your environment.',
      'noSave',
    )
  } else if (install?.success) {
    // 2. pre-commit autoupdate
    await new Deno.Command('pre-commit', {
      args: ['autoupdate'],
      cwd: baseRoot,
    }).output()
  }

  return response
}
