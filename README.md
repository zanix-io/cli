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

To install **Zanix CLI** globally, use [Deno](https://deno.com/) with following
command:

```bash
deno install -A -g -n zanix jsr:@zanix/cli@[version]
```

### Running a Shell Script from a URL

If you need to execute a `.sh` script from a web URL, you can use the following
methods:

1. **Using `curl`**:

   ```bash
   curl -sSL https://jsr.io/@zanix/cli/[version]/src/installation/setup.sh -o .zanix.installer && sh .zanix.installer && rm -f .zanix.installer
   ```

2. **Using `wget`**:

   ```bash
   wget -qO- https://jsr.io/@zanix/cli/[version]/src/installation/setup.sh | sh
   ```

   - `curl -sSL`: Downloads the script and pipes it into `bash` for execution.
     This is useful for automating script execution directly from the web.
   - `wget -qO-`: Does the same using `wget`, which is another tool for
     downloading files.

### Running a PowerShell Script from a URL

If you need to execute a **PowerShell** script (`zanix.ps1`) directly from a
URL, you can use the following methods:

1. **Download and execute with `Invoke-Expression`:**

   This command downloads and executes the script directly in PowerShell:

   ```powershell
   Invoke-Expression (Invoke-WebRequest -Uri "https://jsr.io/@zanix/cli/[version]/src/installation/setup.ps1" -UseBasicP)
   ```

2. **Download the script first, then execute manually:**

   - First, download the script using `Invoke-WebRequest`:

     ```powershell
     Invoke-WebRequest -Uri "https://jsr.io/@zanix/cli/[version]/src/installation/setup.ps1" -OutFile "zanix.ps1"
     ```

   - Then, execute the downloaded script:

     ```powershell
     .\zanix.ps1
     ```

3. **Run the script with Administrator privileges:**

   To run the script with elevated permissions (Administrator), use this
   command:

   ```powershell
   Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File 'zanix.ps1'" -Verb RunAs
   ```

4. **Change Execution Policy if needed:**

   If you encounter an error due to execution policies, you may need to change
   the policy to allow the script to run. You can temporarily change the policy
   with the following command:

   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

### Security Warning

**Be cautious!** Running scripts downloaded from the web can be risky,
especially if you don’t trust the source. Always ensure to review the content of
the script before executing it.

Replace `[version]` with the actual version number when needed.

---

**Important:**

1. **Install Deno**: Ensure Deno is installed on your system. If not, follow the
   [official installation guide](https://docs.deno.com/runtime/getting_started/installation).

2. **Install VSCode Extension**: If using Visual Studio Code, install the **Deno
   extension** for syntax highlighting, IntelliSense, and linting. Get it from
   the
   [VSCode marketplace](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

3. **Add Deno to PATH**: Ensure Deno is in your system’s `PATH` so the plugin
   works correctly:
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
