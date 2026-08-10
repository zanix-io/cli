# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `zanix new server`/`spacecraft` now also seed a `worker.ts` entrypoint (`Zanix.startWorker()`)
  and a matching `worker` task in `deno.json` (same permissions as `start`, pointed at `worker.ts`)
  — a standalone AsyncMQ background-jobs process, always its own separate process from `mod.ts`'s
  own `start`. Plain `space` projects don't get one (no `@zanix/core` dependency). See
  [docs/new.md](docs/new.md#server) and [docs/DEPLOY.md](docs/DEPLOY.md#running-the-worker-process)
  for how to run it in production (the generated `Dockerfile`'s image serves both roles — the
  deployment target picks `start`/`worker` via a `CMD` override, never a baked-in platform-specific
  env var check).
- `zanix prepare --docker [-p, --project-type <type>]` — generates a `Dockerfile` and
  `.dockerignore` for containerized deployment. Only `'server'`/`'space'`/`'space-server'` produce
  a `Dockerfile` (a two-stage build; the `space`/`space-server` variant additionally installs real
  npm deps and runs `zanix space build`), `.dockerignore` is generated regardless of type. Docker
  is one deployment option among several, never the assumed default — see
  [docs/DEPLOY.md](docs/DEPLOY.md) and [docs/prepare.md](docs/prepare.md#-d---docker).
- `zanix generate subscriber <name> [-q, --queue <route>]` — generates a queue subscriber shell
  (`subscribers/<name>.subscriber.ts`, `@Subscriber`/`ZanixSubscriber` from `@zanix/asyncmq`).
  `--queue` defaults to the kebab-cased name when omitted. See
  [docs/generate.md](docs/generate.md#subscriber).
- `zanix generate handler <name> [-t, --type rest|graphql|socket|ssr]` — `handler` now generates 3
  additional handler types beyond REST: `graphql` (`<name>.resolver.ts`, `@Resolver`/
  `ZanixResolver`), `socket` (`<name>.socket.ts`, `@Socket`/`ZanixWebSocket`), and `ssr`
  (`<name>.ssr.ts`, `@SsrController`/`ZanixSsrController`). `--type` defaults to `rest`
  (`<name>.handler.ts`, unchanged behavior). See [docs/generate.md](docs/generate.md#handler).
- `zanix generate connector <name> [-s, --slot database|cache:<subtype>]` — `connector` now
  supports generating a shell for a **custom** implementation of a core connector slot: `--slot
  database` (extends `ZanixDatabaseConnector`) or `--slot cache:<subtype>` (extends
  `ZanixCacheConnector`, e.g. `cache:redis`). Without `--slot`, unchanged generic-connector
  behavior. `asyncmq`/`kvLocal`/`search` slots aren't covered. See
  [docs/generate.md](docs/generate.md#connector).

### Changed

- **Breaking:** the installed binary is now `zanix` instead of `znx`. `znx` was never actually
  installable as a second alias (`CLI_ALIASES`'s `.alias()` on the root command had no effect on
  the OS `PATH` — only `deno install -n <name>` does, and only `znx` was ever installed). If you
  already have `znx` installed, run `deno uninstall -g znx` once, then reinstall with
  `deno install -A -g -n zanix https://jsr.io/@zanix/cli/[version]/.dist/app.mjs`.
- The publish workflow now syncs `src/installation/setup.sh`/`setup.ps1`'s fallback version with
  `deno.jsonc`'s real `version` before publishing, so the installer's default version can no
  longer drift out of date across releases.

### Removed

- **Breaking:** `zanix new` no longer scaffolds a `zanix/` folder (`config.ts`/`secrets.sqlite`).
  Both files were always generated empty (fetched from an `@zanix/core` `src/templates/` that has
  never had any content published), and nothing anywhere in the ecosystem reads them.
- **Breaking:** `zanix.hash` is no longer written to a generated project's `deno.json(c)`. It was
  only ever written and re-derived, never read by any real consumer — confirmed by an exhaustive
  audit across the whole ecosystem. Existing projects that already have `zanix.hash` in their
  config keep it as a static, inert value; it's no longer regenerated on later `zanix
  new`/`zanix prepare` runs.

### Fixed

- `zanix generate` (with no artifact) silently produced no output at all — neither help nor an
  error — unlike `zanix new`/`zanix prepare`, which both already guarded this case. Now shows
  usage and a clear error.
- Every `zanix generate <artifact>` and `zanix new <type>` action failed to `await`/`return` its
  own async work before considering the command "done" — harmless in practice (Deno keeps the
  process alive until pending promises settle) but fragile, and it meant `zanix new`'s automatic
  `prepare` step could in principle start running before the scaffold it depends on had finished
  writing. Now properly chained.

## [1.1.0] - 2026-08-05

### Added

- `zanix generate <artifact> <name>` (alias `zanix g`) — adds a single artifact to an existing
  project: `seeder`, `repository`, `handler`, `rto` (a field DSL via repeatable `--field
  name:type`), `connector`, `interactor`, and `job` (`--cron` for a scheduled job instead of an
  on-demand one). See [docs/generate.md](docs/generate.md).
- `README.md`, `docs/{new,generate,build,prepare}.md`, and `ENGINEERING.md` — real command
  documentation and a durable architecture reference. Previously the README was a stale generic
  template with no documented commands, and `docs/` didn't exist.

### Changed

- The `build`, `prepare` (Git/GitHub/editor scaffolding), and `new` project-tree implementation
  moved into this repo from `@zanix/utils` — this repo was already the only real consumer of that
  code. `@zanix/utils` no longer exports `compileAndObfuscate`, `prepareGithub`,
  `createVSCodeConfig`, `getZanixPaths`, `getAllZanixLibrariesInfo`, or the option types describing
  them.
- `zanix new server`'s handler/RTO/repository/seeder example files are now generated locally by
  this repo's own generator templates instead of being fetched over JSR from
  `@zanix/server`/`@zanix/datamaster`'s `src/templates/` — one source of truth per artifact shape.
- The project's own `CHANGELOG.md`/`LICENSE` moved from `docs/` to the repo root.

## [1.0.7] - 2025-10-17

### Fixed

- Readme installation instructions
- pre commit

## [1.0.6] - 2025-10-17

### Fixed

- Installation dependencies and publish
- Prepare command on new

### Added

- Functional testing

## [1.0.5] - 2025-10-16

### Fixed

- Route paths
- Folder names
- Config imports

### Added

- Pre commit support

## [1.0.4] - 2025-09-08

### Fixed

- Config relative paths fix
- Github config fix

### Added

## [1.0.3] - 2025-03-18

### Added

- Some tests.

### Fixed

- New command

## [1.0.2] - 2025-03-18

### Fixed

- Installation version
- Config module info
- Some documentation

## [1.0.1] - 2025-03-17

### Fixed

- Submodules and Github actions.

## [1.0.0] - 2025-03-17

### Initial Release

- First version of `Zanix Cli`.
- Provides CLI options
