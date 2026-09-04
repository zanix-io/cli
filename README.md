# Zanix - CLI

[![Version](https://img.shields.io/jsr/v/@zanix/cli?color=blue&label=jsr)](https://jsr.io/@zanix/cli/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/cli?color=blue&label=git)](https://github.com/zanix-io/cli/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Table of Contents

1. [Description](#description)
2. [Features](#features)
3. [Installation](#installation)
4. [Basic Usage](#basic-usage)
5. [Documentation](#documentation)
6. [Contributing](#contributing)
7. [Changelog](#changelog)
8. [License](#license)
9. [Resources](#resources)

## Description

The **Zanix Framework** `CLI` is the command-line tool for building and
maintaining `Zanix` projects: bootstrap a new project from scratch, add
individual artifacts (handlers, RTOs, repositories, ...) to an existing one,
compile/obfuscate your code for production, and scaffold Git hooks, CI workflow,
and editor configuration — all from one `zanix` binary.

## Features

- **`zanix new <type>`** — bootstrap a whole new project (`app`, `space`,
  `server`, `spacecraft`, or `library`).
- **`zanix generate <artifact> <name>`** — add one artifact (`seeder`,
  `repository`, `handler`, `rto`, `connector`, `interactor`, `job`,
  `dlqprocessor`, `subscriber`, `middleware`, `globalmiddleware`, `openapi`,
  `graphql-schema`, `comet`, `component`, `page`, `layout`, `error`,
  `loading`, `not-found`) to an already-existing project.
- **`zanix build`** — compile and optionally obfuscate/bundle your code with
  esbuild.
- **`zanix space <dev|build>`** — run a `@zanix/space` frontend project in dev
  mode with real HMR, or build its real, production client bundle.
- **`zanix prepare`** — scaffold Git hooks, a GitHub Actions publish workflow,
  editor configuration (currently VS Code), and (opt-in, `--docker`) a
  `Dockerfile`/`.dockerignore` for containerized deployment — one destination
  option among several, see [`docs/deploy.md`](./docs/deploy.md).
- **`zanix report-issue`** — file a real GitHub issue via the REST API (no
  `gh` CLI required) against any `zanix-io/<repo>`, using a `GITHUB_TOKEN`
  from the environment.
- **`zanix check-cycles`** — detect a real intra-package circular import
  combined with a top-level side effect that reads a binding still inside
  that same cycle. Exits non-zero on a confirmed finding, safe to gate CI on.
- **`zanix check-duplicates`** — detect a `@zanix/*` package resolved to more
  than one distinct version at once in `deno.lock` — the dual-package-hazard
  shape that makes `@zanix/server`'s identity-keyed DI container throw
  `Target is not a constructor` for a class that's really the same class
  loaded twice. Exits non-zero on a confirmed finding, safe to gate CI on.
- **`zanix credentials mesh <id1> <id2> ...`** — generate a real, matched set
  of RSA keypairs for N cooperating service identities, printing
  ready-to-paste, correctly-cross-referenced `.env` blocks. Local-dev/
  first-integration-setup convenience only — never writes a file, never a
  production secrets-provisioning path.
- **`zanix credentials password-hash [password]`** — hash a password via
  `@zanix/helpers`'s `generateHash()`, printing a single-quoted, ready-to-paste
  `.env` value (closes a real Deno `--env-file` `$`-expansion footgun).
  Prompts interactively (hidden input) when no password argument is given.

## Installation

### Install Zanix CLI

Requires [Deno](https://docs.deno.com/runtime/getting_started/installation)
already installed and on your `PATH`. Then install with the same command on
macOS, Linux, and Windows:

```sh
deno run -A jsr:@zanix/cli@[version]/setup [version]
```

Replace both `[version]` with the actual version number — the first selects
the setup script's own version, the second the version to install (normally
the same value).

### Security Warning

**Be cautious!** Running a script from a source you don't trust can be risky.
Review [the setup script's source](https://jsr.io/@zanix/cli/[version]/src/installation/setup.ts)
before running it if you'd like to confirm what it does first.

---

**Important:**

1. **Install VSCode Extension**: If using Visual Studio Code, install the **Deno
   extension** for syntax highlighting, IntelliSense, and linting. Get it from
   the
   [VSCode marketplace](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

2. **Add Deno to PATH**, if the installer didn't already:
   - **macOS/Linux**: Add to `.bashrc`, `.zshrc`, or other shell config files:
     ```bash
     export PATH="$PATH:/path/to/deno"
     ```
   - **Windows**: Add the Deno folder to your system’s `PATH` via Environment
     Variables.

---

## Basic Usage

Once installed, every command is available through the `zanix` binary.

Bootstrap a new server project (this also runs `prepare -g -e` for you, unless
`--no-prepare` is passed), then add a couple of artifacts to it:

```bash
zanix new server my-api
cd my-api

zanix generate handler users
zanix generate rto users --field name:string --field email:email
zanix build
```

### Help Command

To view a list of available commands and get detailed usage information, run:

```bash
zanix --help
zanix generate --help
```

This command will display the general help information and a list of all
available commands.

## Documentation

Full guides for every command live under [`docs/`](./docs):

- [`new`](./docs/new.md) — bootstrap a whole new project (`app`, `space`,
  `server`, `spacecraft`, `library`).
- [`generate`](./docs/generate.md) — add one backend artifact (seeder,
  repository, handler, RTO, connector, interactor, job, DLQ processor,
  subscriber, middleware, global middleware, OpenAPI spec, GraphQL schema
  cache) to an existing project; see
  [`generate-space.md`](./docs/generate-space.md) for the 7 frontend
  artifacts (comet, component, page, layout, error boundary, loading
  fallback, not-found view).
- [`build`](./docs/build.md) — compile and optionally obfuscate/bundle your
  code.
- [`space`](./docs/space.md) — run a `@zanix/space` project in dev mode with
  real HMR, or build its real, production client bundle.
- [`prepare`](./docs/prepare.md) — scaffold Git hooks, CI workflow, editor
  configuration, and Docker packaging.
- [`report-issue`](./docs/report-issue.md) — file a real GitHub issue via the
  REST API, no `gh` CLI required.
- [`check-cycles`](./docs/check-cycles.md) — detect a real intra-package
  circular import combined with a top-level side effect, safe to gate CI on.
- [`check-duplicates`](./docs/check-duplicates.md) — detect a `@zanix/*`
  package resolved to more than one distinct version at once in `deno.lock`,
  safe to gate CI on.
- [`credentials`](./docs/credentials.md) — generate a real, matched set of RSA
  keypairs for a multi-identity service-to-service auth mesh, or a
  single-password hash, printing ready-to-paste `.env` values; never writes a
  file.
- [`DEPLOY`](./docs/deploy.md) — destination-agnostic deployment (Docker, a bare
  Deno host, Deno Deploy).

For the Zanix framework itself, see the
[Zanix organization on GitHub](https://github.com/zanix-io).

## Contributing

If you have any questions, suggestions, or feedback, you can reach out to the
author via email at [icalle@utp.edu.co](mailto:icalle@utp.edu.co). You can also
connect with the author on
[Linkedin](https://mx.linkedin.com/in/ismael-calle-marulanda) for updates and
announcements about software.

## Changelog

For a detailed list of changes, please refer to the [CHANGELOG](./CHANGELOG.md)
file.

## License

This library is licensed under the MIT License. See the [LICENSE](./LICENSE)
file for more details.

## Resources

- [Deno Documentation](https://docs.deno.com/)
- [Zanix Framework Documentation](https://github.com/zanix-io)

---

_Developed with ❤️ by Ismael Calle | [@iscam2216](https://github.com/iscam2216)_
