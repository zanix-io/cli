# `zanix prepare` — Git hooks, CI workflow, editor config, and Docker packaging

`zanix prepare [root]` scaffolds project setup that's tedious to hand-write: Git hooks, a GitHub
Actions publish workflow, `.gitignore`, editor configuration, and (opt-in) Docker packaging. You
must pass at least one of `-g`/`--github`, `-e`/`--editor`, or `-d`/`--docker` — running
`zanix prepare` with none of the three errors out.

```bash
zanix prepare -g -e
```

| Option                      | Description                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --github`              | Initialize Git (if needed) and set up GitHub-related configuration — see below.                                                                                                                                                                         |
| `-e, --editor [editor]`     | Set up editor configuration. Only `'vscode'` is supported today (also the default when the flag is passed with no value).                                                                                                                               |
| `-d, --docker`              | Generate a `Dockerfile` and `.dockerignore` for containerized deployment — see below.                                                                                                                                                                   |
| `-p, --project-type <type>` | `'library'`, `'space-server'`, `'space'`, `'server'`, or `'app'` — used when generating the publish workflow AND the Dockerfile (only `'library'`/`'app'` produce a publish workflow; only `'server'`/`'space'`/`'space-server'` produce a Dockerfile). |
| `--lint-files <extensions>` | Comma-separated file extensions the pre-commit hook's linter step targets (e.g. `js,ts,tsx`).                                                                                                                                                           |
| `--fmt-files <extensions>`  | Comma-separated file extensions the pre-commit hook's formatter step targets (e.g. `js,md,ts,json`).                                                                                                                                                    |
| `--use-pre-commit`          | Use the [pre-commit](https://pre-commit.com/) framework instead of this repo's own hook scripts.                                                                                                                                                        |

## `-g, --github`

Sets up, in order:

- **Git hooks** (unless `--use-pre-commit` is passed, see below):
  - `pre-commit` — runs `deno fmt`/`deno lint --fix` on staged files matching `--fmt-files`/
    `--lint-files`, then re-stages them. Fails the commit if either step fails.
  - `pre-push` — runs `deno test --allow-all`; if a test contains `.only`/`.skip`, the push is
    blocked (override with Git's own `--no-verify`).
- **`.github/workflows/publish.yml`** — runs `deno test --allow-all` then `deno publish` on every
  push/PR to the main branch.
- **`.gitignore`** — a base ignore file for a Deno project.

Passing `--use-pre-commit` installs the [pre-commit](https://pre-commit.com/) framework's own
`pre-commit`/`pre-push` hooks (pointed at `zanix-io/utils`'s hook definitions) instead of writing
this repo's own shell scripts.

## `-e, --editor`

Writes VS Code's recommended settings/extensions config for a Deno project. `vscode` is currently
the only supported value — any other value errors out.

## `-d, --docker`

Generates, at the project root (skipped if the file already exists):

- **`Dockerfile`** — only for `'server'`, `'space'`, and `'space-server'` (`-p`/`--project-type`);
  any other type logs a warning and writes nothing, since nothing in `'library'`/`'app'` calls
  `Deno.serve()`. Two-stage build (a cached dependency layer, then the runtime image):
  - `'server'`: `deno cache` in the build stage, plain source copy in the runtime stage.
  - `'space'`/`'space-server'`: the build stage additionally runs `deno install` (this project's own
    real npm dependencies — Vite, React, Tailwind, `sharp`) and `zanix space build` (producing
    `dist/client`), both copied into the runtime stage via `COPY --from=build`.
  - `CMD ["task", "start"]` reuses the `start` task this project's own `deno.json` already declares
    (`baseZnxConfig`) — never a separately hand-written permission list, so the two can't drift.
- **`.dockerignore`** — always generated, regardless of project type.

Docker is one deployment option among several, never the assumed default — see
[`DEPLOY.md`](./DEPLOY.md) for the full picture (including two known v1 gaps: no built-in graceful
shutdown or health-check route yet).

## See also

- [`new`](./new.md) — runs `prepare -g -e` for you automatically, unless `--no-prepare` is passed.
- [`generate`](./generate.md), [`build`](./build.md) — the other two commands.
- [`DEPLOY.md`](./DEPLOY.md) — destination-agnostic deployment, of which `--docker` is one option.
