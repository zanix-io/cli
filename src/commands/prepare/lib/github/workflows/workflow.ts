import type { WorkflowOptions } from 'commands/prepare/lib/typings.ts'

import { createWorkflow } from 'commands/prepare/lib/github/workflows/main.ts'

/**
 * Creates the `GitHub Actions` workflow(s) for a project: `ci.yml` (checkout, `Setup Deno`,
 * `deno fmt --check`, `deno lint`, `zanix check-cycles`) is written UNCONDITIONALLY, for every
 * real project type. `publish.yml` (checkout, `Setup Deno`, `deno test`, `deno publish`) is
 * written for `'library'`/`'app'` BY DEFAULT — those two types exist specifically to be
 * published — and for `'server'`/`'space'`/`'space-server'` only when `options.publish` is
 * explicitly `true`. Those three types are USUALLY a deployed service, not a published package
 * (`zanix/iam` — a self-hostable reference service that ALSO wants zero-clone JSR distribution —
 * is the deliberate exception, not the norm): defaulting `publish.yml` on for them would mean
 * `deno publish` running, and failing, on every push to a repo that was never registered on JSR —
 * a real, confirmed regression this default avoids. `baseZnxConfig`'s own `exports`/`publish`
 * shape in `deno.json` stays unconditional regardless (see that function's own doc) — declaring a
 * real entrypoint is inert until something actually runs `deno publish`, so every type gets it,
 * independent of whether THIS function also wires the CI step that does.
 *
 * `ci.yml` also declares `workflow_call`, so `publish.yml` — whenever it IS written — doesn't run
 * in parallel, unrelated to `ci.yml`: its own `ci` job invokes `ci.yml` as a reusable workflow
 * (`uses: ./.github/workflows/ci.yml`), and its `publish` job declares `needs: ci`: a
 * `check-cycles` failure blocks `deno publish` for real, not just runs a separate, disconnected
 * job that happens to also fail. The `Publish to Deno` STEP additionally checks
 * `needs.ci.result == 'success'` explicitly, not just the job-level `needs: ci` default
 * skip-on-failure — the explicit check still holds even if the `publish` job's own `if:` is ever
 * overridden (e.g. to `always()`, to get diagnostics on a failing run), which would otherwise
 * silently defeat the job-level guard alone.
 *
 * @param options The options for configuring the workflow(s).
 *   - `baseFolder`: The folder name where the workflow file(s) should be created.
 *   - `baseRoot`: The base root directory where the folder should be created.
 *   - `mainBranch`: The main branch that will trigger the workflow(s) when publishing a new version.
 *   - `projectType`: Decides `publish.yml`'s own DEFAULT (`'library'`/`'app'` → on), when
 *     `publish` itself is left unset. Defaults to `'library'`, matching `baseZnxConfig`'s own
 *     default.
 *   - `publish`: Explicit override — `true` forces `publish.yml` on regardless of `projectType`
 *     (the `zanix/iam` case: a `'space-server'` that DOES want zero-clone JSR distribution),
 *     `false` forces it off (including for `'library'`/`'app'`). Left unset, the `projectType`
 *     default above applies.
 * @returns `true` only when every workflow file this call was responsible for was actually
 *   written — `false` if any of them was skipped (e.g. already exists) or failed silently.
 */
export async function createGitWorkflows(
  options: WorkflowOptions = {},
): Promise<boolean> {
  const { mainBranch = 'master', projectType = 'library', publish, ...opts } = options
  const replaceMainBranch = (content: string) => content.replace(/\$\{MAIN_BRANCH\}/g, mainBranch)

  const shouldPublish = publish ?? (projectType === 'library' || projectType === 'app')

  const results = await Promise.all([
    createWorkflow({ filename: 'ci', ...opts }, replaceMainBranch),
    ...(shouldPublish ? [createWorkflow({ filename: 'publish', ...opts }, replaceMainBranch)] : []),
  ])

  return results.every(Boolean)
}
