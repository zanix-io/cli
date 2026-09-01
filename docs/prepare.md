# `zanix prepare` — Git hooks, CI workflow, editor config, and Docker packaging

`zanix prepare [root]` scaffolds project setup that's tedious to hand-write: Git
hooks, a GitHub Actions publish workflow, `.gitignore`, editor configuration,
and (opt-in) Docker packaging. You must pass at least one of `-g`/`--github`,
`-e`/`--editor`, or `-d`/`--docker` — running `zanix prepare` with none of the
three errors out.

```bash
zanix prepare -g -e
```

| Option                      | Description                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --github`              | Initialize Git (if needed) and set up GitHub-related configuration — see below.                                                                                                                                                                                             |
| `-e, --editor [editor]`     | Set up editor configuration. Only `'vscode'` is supported today (also the default when the flag is passed with no value).                                                                                                                                                   |
| `-d, --docker`              | Generate a `Dockerfile` and `.dockerignore` for containerized deployment — see below.                                                                                                                                                                                       |
| `-p, --project-type <type>` | `'library'`, `'space-server'`, `'space'`, `'server'`, or `'app'` — used when generating the GitHub Actions workflow(s) AND the Dockerfile (every type gets `ci.yml`; `'library'`/`'app'` ADDITIONALLY get `publish.yml`; every type but `'library'` produces a Dockerfile). |
| `--lint-files <extensions>` | Comma-separated file extensions the pre-commit hook's linter step targets (e.g. `js,ts,tsx`).                                                                                                                                                                               |
| `--fmt-files <extensions>`  | Comma-separated file extensions the pre-commit hook's formatter step targets (e.g. `js,md,ts,json`).                                                                                                                                                                        |
| `--hooks-engine <engine>`   | Which engine manages the Git hooks: `'native'` (this repo's own shell scripts, default) or `'framework'` (the [pre-commit](https://pre-commit.com/) framework). Any other value errors out.                                                                                 |

## `-g, --github`

Sets up, in order:

- **Git hooks** (`--hooks-engine native`, the default):
  - `pre-commit` — runs `deno fmt`/`deno lint --fix` on staged files matching
    `--fmt-files`/ `--lint-files`, then re-stages them. Fails the commit if
    either step fails.
  - `pre-push` — runs `deno test --allow-all`; if a test contains
    `.only`/`.skip`, the push is blocked (override with Git's own
    `--no-verify`).
- **`.github/workflows/ci.yml`** — runs `deno fmt --check`, `deno lint`, then
  `zanix check-cycles` (see [`check-cycles`](./check-cycles.md) — the
  intra-package circular-import hazard check), each as its own step so a
  failure's cause is unambiguous from the job log alone, on every push/PR to
  the main branch. Generated for EVERY project type. Also declares
  `workflow_call`, so it doubles as a reusable workflow, not just a
  standalone one.
- **`.github/workflows/publish.yml`** — generated ADDITIONALLY, only for
  `'library'`/`'app'`. Two jobs, not two independent runs: a `ci` job
  invokes `ci.yml` as a reusable workflow (`uses:
  ./.github/workflows/ci.yml`), and the `publish` job declares `needs: ci`
  — `deno test` plus `deno publish` (run on an actual push, never on an
  open PR) only start once `ci.yml`'s own `deno fmt --check`/`deno lint`/
  `check-cycles` steps have actually succeeded, not in parallel with them.
- **`.gitignore`** — a base ignore file for a Deno project.

Passing `--hooks-engine framework` installs the
[pre-commit](https://pre-commit.com/) framework's own `pre-commit`/`pre-push`
hooks (pointed at `zanix-io/utils`'s hook definitions) instead of writing this
repo's own shell scripts. Requires the `pre-commit` binary to already be
installed (`pip install pre-commit` or `brew install pre-commit`) — otherwise
`pre-commit install` fails silently with a warning and `.pre-commit-config.yaml`
is left in place but never activated.

```bash
zanix prepare -g --hooks-engine framework
```

## `-e, --editor`

Writes VS Code's recommended settings/extensions config for a Deno project.
`vscode` is currently the only supported value — any other value errors out.

## `-d, --docker`

Generates, at the project root (skipped if the file already exists):

- **`Dockerfile`** — for `'server'`, `'space'`, `'space-server'`, and `'app'`
  (`-p`/`--project-type`); `'library'` logs a warning and writes nothing, since
  nothing there ever calls `Deno.serve()`. Two-stage build (a cached dependency
  layer, then the runtime image):
  - `'server'`/`'app'`: share the SAME template — `deno cache` in the build
    stage, plain source copy in the runtime stage, `CMD ["task", ...]` in the
    runtime stage. `'server'` caches/runs `mod.ts`/`start`; `'app'` caches/runs
    `serve.ts`/`serve` instead — a Zanix App's own `mod.ts` is manifest-only,
    never a runnable entrypoint, so `'app'` ALSO scaffolds:
    - **`serve.ts`** — a real `bootstrapRemoteApp` entrypoint
      (`@zanix/app/runtime`), since `zanix new app` never generates one (most
      Zanix Apps are meant to be embedded, never run standalone). Never
      overwritten if it already exists.
    - A matching **`serve` task** in this project's own `deno.json`/`deno.jsonc`
      (`deno run --env-file=.env <perms> serve.ts`) — a SURGICAL merge (only
      that one key is added/read; every other field is left untouched), never
      overwriting an existing `serve` task.
  - `'space'`/`'space-server'`: the build stage additionally runs `deno install`
    (this project's own real npm dependencies — Vite, React, Tailwind, `sharp`)
    and `zanix space build` (producing `.dist/client`), both copied into the
    runtime stage via `COPY --from=build`.
  - `CMD ["task", "start"]`/`CMD ["task", "serve"]` reuses a task this project's
    own `deno.json` already declares, rather than a separately hand-written
    permission list, so the two can't drift.
- **`.dockerignore`** — always generated, regardless of project type.

Docker is one deployment option among several, never the assumed default — see
[`deploy.md`](./deploy.md) for the full picture. `GET /health`/`/ready` and
graceful shutdown (`SIGINT`/`SIGTERM`) are both built in automatically
(`bootstrapServers`/`bootstrapRemoteApp` — see `@zanix/server`'s and
`@zanix/app`'s own READMEs), not gaps to work around.

## See also

- [`new`](./new.md) — runs `prepare -g -e` for you automatically, unless
  `--no-prepare` is passed.
- [`generate`](./generate.md), [`build`](./build.md) — the other two commands.
- [`deploy.md`](./deploy.md) — destination-agnostic deployment, of which
  `--docker` is one option.
