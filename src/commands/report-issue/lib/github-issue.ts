/**
 * `zanix report-issue`'s real HTTP orchestration: plain `fetch()` against GitHub's REST API — no
 * `gh` CLI shell-out, so this works identically whether or not `gh` happens to be installed on the
 * machine.
 */

/** The env var this command reads for authentication. Holds the var's literal name, resolved at
 * the use site below — never the resolved token value itself. */
export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN'

/** Every `--repo` resolves under this fixed GitHub org — `zanix report-issue` never targets any
 * other org. */
export const GITHUB_ORG = 'zanix-io'

/** One real, published Zanix repo `--repo` can default to — the common case: a `claude-skills`
 * finding (a stale skill/agent claim). A real package bug found incidentally passes `--repo`
 * explicitly instead (e.g. `--repo cli`). */
export const DEFAULT_REPO = 'claude-skills'

/** Input for {@linkcode createGithubIssue}. */
export interface CreateGithubIssueOptions {
  /** The `zanix-io/<repo>` repository to file the issue against. */
  repo: string
  /** The issue title. */
  title: string
  /** The issue body (markdown supported). */
  body?: string
  /** Zero or more labels to attach, passed through to GitHub as-is (no fixed enum enforced
   * here — labels are a GitHub-side concept that might not even exist yet on a given repo). */
  labels?: string[]
}

/** What a successful {@linkcode createGithubIssue} call resolves to. */
export interface CreateGithubIssueResult {
  /** The (created, or matched-existing) issue's real, clickable URL (GitHub's own `html_url`) —
   * the caller needs this confirmation/link, not just a bare "done." */
  htmlUrl: string
  /** `true` when an exact-title match was found among the repo's OPEN issues and nothing new was
   * created — the caller (`commands/report-issue/main.ts`) must surface this loudly (e.g.
   * `logger.warn`), never treat it the same as a fresh creation. `false` when a new issue was
   * actually filed. */
  alreadyExists: boolean
}

/** One GitHub issue as returned by the `GET .../issues` list endpoint — only the fields this
 * module actually reads. GitHub's issues endpoint also returns pull requests; a `pull_request`
 * key present on an entry (even `null`-valued in some API shapes) marks it as a PR, not an
 * issue, so title-matching against it would be a false positive. */
interface GithubIssueListEntry {
  title: string
  'html_url': string
  'pull_request'?: unknown
}

/** Builds the standard authenticated GitHub REST headers this module's requests share. */
function githubHeaders(token: string, withContentType: boolean): HeadersInit {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (withContentType) headers['Content-Type'] = 'application/json'
  return headers
}

/** Turns a non-2xx GitHub REST response into the same specific, actionable `Error` shape across
 * every call site in this module (create, and the dedup list-issues lookup) — never a generic
 * "failed" message. See {@linkcode createGithubIssue}'s own JSDoc for the per-status mapping. */
async function throwForFailedResponse(response: Response, repo: string, action: string) {
  const errorBody = await response.text()

  if (response.status === 404) {
    throw new Error(
      `Repository '${GITHUB_ORG}/${repo}' was not found — check '--repo ${repo}' matches a ` +
        `real, existing repository under the '${GITHUB_ORG}' GitHub org (and that the ` +
        `configured '${GITHUB_TOKEN_ENV}' can see it, if it's private).`,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `GitHub rejected the configured '${GITHUB_TOKEN_ENV}' (HTTP ${response.status}): ` +
        errorBody,
    )
  }

  throw new Error(
    `GitHub API request to ${action} on '${GITHUB_ORG}/${repo}' failed ` +
      `(HTTP ${response.status}): ${errorBody}`,
  )
}

/**
 * Looks up an existing OPEN issue in `zanix-io/<repo>` whose title exactly matches `title` —
 * the real dedup check `createGithubIssue` runs before ever filing a new issue.
 *
 * Scope decisions, deliberate:
 * - **Open issues only, not closed.** A closed issue means the finding was already fixed; the
 *   case this guards against is a periodic sweep re-finding the same STILL-UNFIXED issue on a
 *   later run. Matching against closed issues too would block legitimately re-filing a
 *   regression once something's already been closed as resolved.
 * - **Exact title match, not fuzzy/prefix-stripped.** The `[<bucket>] <repo-or-skill>:
 *   <description>` title convention this command expects is structured and short — an exact
 *   match has effectively no false-positive risk. A looser match (e.g. ignoring the bracketed
 *   bucket label) risks conflating two genuinely different findings that happen to share a
 *   prefix; simpler and safer wins here over catching hypothetical title drift.
 * - **The repo issues-list endpoint, not GitHub's `/search/issues`.** Search tokenizes on
 *   punctuation and effectively ignores brackets/quotes in a query — exactly the characters
 *   this system's own titles start with (`[bug]`, `[gap]`, `[discussion]`) — so a search-API
 *   query would risk both false positives (fuzzy multi-token matching) and encoding footguns.
 *   Listing open issues and comparing titles locally with `===` sidesteps that class of bug
 *   entirely, at the cost of only paging the first 100 open issues (`per_page=100`, no further
 *   pagination) — acceptable for repos of this ecosystem's real size; not attempting to be a
 *   general-purpose issue search.
 *
 * @param repo - The `zanix-io/<repo>` repository to check.
 * @param title - The exact issue title to look for among OPEN issues.
 * @param token - The already-resolved `GITHUB_TOKEN` value (never re-reads the env itself).
 * @returns The matching open issue's `htmlUrl`, or `undefined` when no exact-title match exists.
 * @throws {Error} When the list request itself fails (bad token, unknown repo, network error) —
 * same mapping as {@linkcode createGithubIssue}.
 */
export async function findExistingOpenIssue(
  repo: string,
  title: string,
  token: string,
): Promise<{ htmlUrl: string } | undefined> {
  const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/issues?state=open&per_page=100`

  const response = await fetch(url, { headers: githubHeaders(token, false) })

  if (!response.ok) {
    await throwForFailedResponse(response, repo, 'list open issues')
  }

  const issues = await response.json() as GithubIssueListEntry[]
  const match = issues.find((issue) => !('pull_request' in issue) && issue.title === title)

  return match ? { htmlUrl: match.html_url } : undefined
}

/**
 * Files a real GitHub issue via `POST https://api.github.com/repos/zanix-io/<repo>/issues` —
 * plain `fetch()`, no `gh` CLI dependency anywhere.
 *
 * Real deduplication runs first: an exact-title match against the repo's OPEN issues (via
 * {@linkcode findExistingOpenIssue}) means nothing new is created — the existing issue's
 * `htmlUrl` is returned instead, with `alreadyExists: true`, so a periodic sweep agent re-finding
 * the same still-unfixed issue on a later run doesn't file a brand-new duplicate every time. This
 * costs one extra GET per call; acceptable — a few hundred ms for a real dedup guarantee, not
 * worth caching/batching away.
 *
 * Every failure mode is surfaced as a specific, actionable `Error`, never a generic "failed":
 * - No `GITHUB_TOKEN` in the environment → tells the caller exactly how to create one and which
 *   env var to set, rather than silently doing nothing (the "zero silent failures" case this
 *   command exists to model).
 * - GitHub rejects the token (401/403) → GitHub's own response body is included verbatim, not
 *   swallowed behind a generic message.
 * - `--repo` doesn't resolve to a real repo under the `zanix-io` org (404) → names the repo that
 *   wasn't found, not just the raw HTTP status.
 * - Any other non-2xx response (e.g. an unknown `--label` GitHub rejects) → the status and
 *   GitHub's own response body are surfaced, so a rejected label doesn't look like a mystery
 *   failure.
 *
 * @param options - `repo`/`title`/optional `body`/optional `labels`, see
 * {@linkcode CreateGithubIssueOptions}.
 * @returns The created (or matched-existing) issue's `htmlUrl`, plus `alreadyExists` — see
 * {@linkcode CreateGithubIssueResult}.
 * @throws {Error} When `GITHUB_TOKEN` is unset, when GitHub rejects a request (dedup lookup or
 * creation), or when either request itself fails (network error).
 */
export async function createGithubIssue(
  options: CreateGithubIssueOptions,
): Promise<CreateGithubIssueResult> {
  const token = Deno.env.get(GITHUB_TOKEN_ENV)

  if (!token) {
    throw new Error(
      `'${GITHUB_TOKEN_ENV}' is not set. Create a GitHub personal access token with the ` +
        `'public_repo' scope (a fine-grained token needs 'Issues: write' instead) at ` +
        `https://github.com/settings/tokens, then set it before running this command again: ` +
        `export ${GITHUB_TOKEN_ENV}=<your-token>`,
    )
  }

  const { repo, title, body, labels } = options

  const existing = await findExistingOpenIssue(repo, title, token)
  if (existing) return { htmlUrl: existing.htmlUrl, alreadyExists: true }

  const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/issues`

  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(token, true),
    body: JSON.stringify({ title, body, labels }),
  })

  if (!response.ok) {
    await throwForFailedResponse(response, repo, 'create an issue')
  }

  const issue = await response.json() as { html_url: string }

  return { htmlUrl: issue.html_url, alreadyExists: false }
}
