import type { WorkflowOptions } from 'commands/prepare/lib/typings.ts'

import { createWorkflow } from 'commands/prepare/lib/github/workflows/main.ts'

/**
 * Creates a `GitHub Actions` workflow to automatically run tests during the publish process.
 *
 * @param options The options for configuring the workflow.
 *   - `baseFolder`: The folder name where the workflow file should be created.
 *   - `baseRoot`: The base root directory where the folder should be created.
 *   - `mainBranch`: The main branch that will trigger the workflow when publishing a new version.
 *   - `projectType`: Optional ZanixProject type to define correct workflow. Defaults to `library`
 */
export function createGitWorkflow(
  options: WorkflowOptions = {},
): Promise<boolean> {
  const { mainBranch = 'master', projectType = 'library', ...opts } = options
  // `app` (a `defineZanixApp()`-based package) is published/consumed exactly like `library` — see
  // `@zanix/app`'s own `docs/PUBLISHING.md` — so it gets the same publish workflow.
  const filename = projectType === 'library' || projectType === 'app' ? 'publish' : null

  return createWorkflow(
    { filename, ...opts },
    (content) => content.replace(/\$\{MAIN_BRANCH\}/g, mainBranch),
  )
}
