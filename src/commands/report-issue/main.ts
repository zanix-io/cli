import { Commander } from 'cli'
import { createGithubIssue, DEFAULT_REPO } from 'commands/report-issue/lib/github-issue.ts'
import logger from '@zanix/logger'

/**
 * `zanix report-issue` — files a real GitHub issue via the REST API (`createGithubIssue`), with no
 * dependency on the `gh` CLI being installed. General-purpose: usable by any human directly from
 * the terminal, or by any consumer-side agent that needs to report a finding (a stale skill/agent
 * claim, an out-of-scope bug found incidentally) without local `git commit`/`push` access to the
 * target repo.
 *
 * `createGithubIssue` deduplicates before filing — an exact-title match among the target repo's
 * OPEN issues means nothing new is created; this action surfaces that loudly via `logger.warn`
 * (never silently, and never conflated with a real `logger.info` creation).
 *
 * A bare `Commander` instance (not registered via `baseArgumentActionCommand`), same shape as
 * `build`'s own single-leaf command (`commands/build/main.ts`) — this command has no sub-leaves of
 * its own and never calls `this.runCommand(...)`, so it doesn't need that helper's argument
 * plumbing.
 */
export default function reportIssueCommand(this: Commander) {
  const cwd = new Commander()

  this.mountGroup('report-issue', cwd)
    .description(
      "File a GitHub issue against a 'zanix-io/<repo>' repository via GitHub's REST API " +
        "(no 'gh' CLI required) — reads a token from GITHUB_TOKEN.",
    )
    .option(
      '--repo <repo:string>',
      `Which 'zanix-io/<repo>' repository to file the issue against.`,
      { default: DEFAULT_REPO },
    )
    .option('--title <title:string>', 'The issue title.')
    .option(
      '--body <body:string>',
      'The issue body (markdown supported). Mutually exclusive with --body-file.',
    )
    .option(
      '--body-file <path:string>',
      'Read the issue body from a file instead of --body — for longer, structured content.',
    )
    .option(
      '--label <label:string>',
      'A label to attach to the issue. Repeatable — pass one --label per label. No fixed set ' +
        'enforced here; if GitHub rejects an unknown label, that error surfaces as-is.',
      { collect: true },
    )
    .action(async (options) => {
      const { repo, title, body, bodyFile, label: labels } = options as {
        repo: string
        title?: string
        body?: string
        bodyFile?: string
        label?: string[]
      }

      if (!title) {
        cwd.throw(new Error("The '--title' option is required."))
        return
      }

      if (body && bodyFile) {
        cwd.throw(new Error("Use either '--body' or '--body-file', not both."))
        return
      }

      let resolvedBody = body

      if (bodyFile) {
        try {
          resolvedBody = await Deno.readTextFile(bodyFile)
        } catch (error) {
          cwd.throw(
            new Error(
              `Could not read '--body-file ${bodyFile}': ${
                error instanceof Error ? error.message : String(error)
              }`,
              { cause: error },
            ),
          )
          return
        }
      }

      try {
        const { htmlUrl, alreadyExists } = await createGithubIssue({
          repo,
          title,
          body: resolvedBody,
          labels,
        })
        if (alreadyExists) {
          logger.warn(
            `Duplicate skipped — an OPEN issue with this exact title already exists, nothing ` +
              `new was filed: ${htmlUrl}`,
          )
        } else {
          logger.info(`Issue created: ${htmlUrl}`)
        }
      } catch (error) {
        cwd.throw(error instanceof Error ? error : new Error(String(error)))
      }
    })
}
