import type { WorkflowOptions } from 'commands/prepare/lib/typings.ts'

import { createWorkflow } from 'commands/prepare/lib/github/workflows/main.ts'

/**
 * Creates the `GitHub Actions` workflow(s) for a project: `ci.yml` (checkout, `Setup Deno`,
 * `deno fmt --check`, `deno lint`, `zanix check-cycles`) is written UNCONDITIONALLY, for every
 * real project type — including `'library'`/`'app'`, which additionally get their own
 * `publish.yml` written alongside it.
 * `'library'`/`'app'` end up with BOTH files; every other real project type (`'server'`,
 * `'space'`, `'space-server'`) ends up with `ci.yml` only.
 *
 * `ci.yml` also declares `workflow_call` (alongside its own `push`/`pull_request` triggers), so
 * `publish.yml` doesn't run in parallel, unrelated to `ci.yml` — its own `ci` job invokes
 * `ci.yml` as a reusable workflow (`uses: ./.github/workflows/ci.yml`), and its `publish` job
 * declares `needs: ci`: a `check-cycles` failure blocks `deno publish` for real, not just runs a
 * separate, disconnected job that happens to also fail. The `Publish to Deno` STEP additionally
 * checks `needs.ci.result == 'success'` explicitly, not just the job-level `needs: ci` default
 * skip-on-failure — the explicit check still holds even if the `publish` job's own `if:` is ever
 * overridden (e.g. to `always()`, to get diagnostics on a failing run), which would otherwise
 * silently defeat the job-level guard alone.
 *
 * @param options The options for configuring the workflow(s).
 *   - `baseFolder`: The folder name where the workflow file(s) should be created.
 *   - `baseRoot`: The base root directory where the folder should be created.
 *   - `mainBranch`: The main branch that will trigger the workflow(s) when publishing a new version.
 *   - `projectType`: Optional ZanixProject type to define which workflow(s) are written. Defaults
 *     to `library`.
 * @returns `true` only when every workflow file this call was responsible for was actually
 *   written — `false` if any of them was skipped (e.g. already exists) or failed silently.
 */
export async function createGitWorkflows(
  options: WorkflowOptions = {},
): Promise<boolean> {
  const { mainBranch = 'master', projectType = 'library', ...opts } = options
  const replaceMainBranch = (content: string) => content.replace(/\$\{MAIN_BRANCH\}/g, mainBranch)

  // `app` (a `defineZanixApp()`-based package) is published/consumed exactly like `library` — see
  // `@zanix/app`'s own `docs/publishing.md` — so it gets the same `publish.yml`, on top of the
  // `ci.yml` every real project type gets.
  const isPublishable = projectType === 'library' || projectType === 'app'

  const results = await Promise.all([
    createWorkflow({ filename: 'ci', ...opts }, replaceMainBranch),
    ...(isPublishable ? [createWorkflow({ filename: 'publish', ...opts }, replaceMainBranch)] : []),
  ])

  return results.every(Boolean)
}
