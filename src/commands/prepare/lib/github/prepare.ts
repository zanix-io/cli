import type { PrepareGithubOptions } from 'commands/prepare/lib/typings.ts'

import { createPrePushHook } from 'commands/prepare/lib/github/hooks/pre-push.ts'
import { createPreCommitHook } from 'commands/prepare/lib/github/hooks/pre-commit.ts'
import { createGitWorkflow } from 'commands/prepare/lib/github/workflows/publish.ts'
import { createIgnoreBaseFile } from 'commands/prepare/lib/github/files/main.ts'
import { createPreCommitYaml } from 'commands/prepare/lib/github/files/pre-commit-config.ts'
import { gitInitialization } from 'commands/prepare/lib/github/hooks/main.ts'

/**
 * Prepares the `GitHub` environment by setting up necessary hooks and workflows.
 * This function ensures that the pre-commit hook, pre-push hook, publish workflow, and `.gitignore` are created.
 *
 * `legacyHooks`'s own native shell-script `pre-commit`/`pre-push` files (and their symlinks into
 * `.git/hooks`) are written unconditionally, EVEN when `usePrecommit` is also set — both
 * mechanisms' files always exist side by side. What `usePrecommit` actually changes is which one
 * gets wired into `.git/hooks`: with `usePrecommit`, `createLink` is forced to `false` for the
 * native hooks (their `.sh` files are still written, just never symlinked), so `pre-commit
 * install`'s own hook (installed separately, via `createPreCommitYaml`) is the one Git actually
 * runs — never both at once.
 *
 * @param {Object} options - Configuration options for setting up hooks and workflows.
 * @param {true | Object} [options.usePrecommit] - Optional configuration for using the pre-commit framework.
 * @param {Object} [options.legacyHooks] - Optional `preCommit`/`prePush` configuration for the legacy hooks.
 * @param {WorkflowOptions} [options.publishWorkflow] - Optional configuration for the publish workflow.
 * @param {Object} [options.gitIgnoreBase] - Optional configuration for the `.gitignore` file creation.
 */
export async function prepareGithub(
  options: PrepareGithubOptions & { root?: string } = {},
): Promise<boolean[]> {
  const {
    legacyHooks = {},
    root,
    publishWorkflow,
    gitIgnoreBase,
    usePrecommit,
  } = options

  await gitInitialization(root)

  const promises = [
    createGitWorkflow(publishWorkflow),
    createIgnoreBaseFile(gitIgnoreBase),
  ]

  let createLink

  if (usePrecommit) {
    promises.push(
      createPreCommitYaml(
        typeof usePrecommit !== 'boolean' ? usePrecommit : undefined,
      ),
    )
    createLink = false
  }

  promises.push(createPreCommitHook({ ...legacyHooks.preCommit, createLink }))
  promises.push(createPrePushHook({ ...legacyHooks.prePush, createLink }))

  return Promise.all(promises)
}
