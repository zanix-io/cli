# `zanix report-issue` command reference

`zanix report-issue` files a real GitHub issue against a `zanix-io/<repo>`
repository through GitHub's REST API — plain `fetch()`, no `gh` CLI shell-out
anywhere. It works identically whether or not the `gh` CLI happens to be
installed on the machine, and needs only a personal access token, not local
`git commit`/`push` access to the target repo.

```bash
GITHUB_TOKEN=<your-token> zanix report-issue --title "Stale claim in skill X"
```

| Option               | Default           | Description                                                                             |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `--repo <name>`      | `'claude-skills'` | Which `zanix-io/<name>` repository to file the issue against.                           |
| `--title <string>`   | —                 | The issue title. Required.                                                              |
| `--body <string>`    | —                 | The issue body (markdown supported). Mutually exclusive with `--body-file`.             |
| `--body-file <path>` | —                 | Read the issue body from a file instead of `--body` — for longer, structured content.   |
| `--label <name>`     | —                 | A label to attach. Repeatable — pass one `--label` per label. No fixed set is enforced. |

## Deduplication

Before filing, the command checks whether the target repo already has an
OPEN issue whose title exactly matches `--title`. If one exists, nothing new
is created — the existing issue's real URL is reported instead, loudly (a
warning, not silence):

```
Duplicate skipped — an OPEN issue with this exact title already exists, nothing new was filed: https://github.com/zanix-io/claude-skills/issues/9
```

This is why a periodic sweep re-finding the same still-unfixed finding on a
later run is safe to re-report with the same title — it won't file a
brand-new duplicate every time. Two deliberate scope choices:

- **Open issues only, not closed.** A closed issue means the finding was
  already fixed; re-filing under the same title is legitimate if it
  regressed.
- **Exact title match, not fuzzy.** This system's own title convention
  (`[<bucket>] <repo-or-skill>: <description>`) is short and structured, so
  an exact match has effectively no false-positive risk — safer than a
  looser match that risks conflating two different findings.

## Authentication

Reads a GitHub personal access token from the `GITHUB_TOKEN` environment
variable. If it's unset, the command fails loudly with instructions instead of
silently doing nothing:

```
'GITHUB_TOKEN' is not set. Create a GitHub personal access token with the
'public_repo' scope (a fine-grained token needs 'Issues: write' instead) at
https://github.com/settings/tokens, then set it before running this command
again: export GITHUB_TOKEN=<your-token>
```

If the token is present but GitHub rejects it (HTTP 401/403), the command
surfaces GitHub's own response body — not a generic "failed" message. If
`--repo` doesn't resolve to a real repository under the `zanix-io` GitHub org
(HTTP 404), the command names the repo it couldn't find rather than printing
a raw HTTP error.

On success, the command prints the created issue's real URL:

```
Issue created: https://github.com/zanix-io/claude-skills/issues/42
```

## Examples

```bash
# The common case: report a finding against claude-skills (the default --repo)
zanix report-issue --title "Stale skill claim: X no longer matches real behavior"

# A real bug in an owning package, found incidentally while doing other work
zanix report-issue --repo cli --title "Silent exit 0 on missing config" \
  --body-file ./handoff-prompt.md --label bug --label from-agent

# Inline body, no labels
zanix report-issue --repo server --title "Drift: docs claim X, code does Y" \
  --body "server/src/foo.ts:42 — the doc says X, the real behavior is Y."
```

## See also

- [`prepare`](./prepare.md) — Git hooks, CI workflow, and editor configuration.
