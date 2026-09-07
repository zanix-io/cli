import type { DockerfileOptions } from 'commands/prepare/lib/typings.ts'

import { readModuleConfig } from '@zanix/utils/helpers'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { createDockerBaseFile } from 'commands/prepare/lib/docker/files/base.ts'
import {
  createAppServeEntrypoint,
  ensureAppServeTask,
  SERVE_MODULE,
} from 'commands/prepare/lib/docker/files/app-entrypoint.ts'
import logger from '@zanix/logger'

// Verified against the real, currently-published `denoland/deno` Docker Hub/GHCR tags — the
// debian-based default variant, not `alpine`: `sharp` (a real npm dep of
// `@zanix/space`) ships a native prebuilt binary that depends on glibc, and alpine/musl support
// isn't guaranteed across every platform it publishes for. Bump this one constant when a newer
// Deno major/minor is worth tracking — never duplicated anywhere else.
const DEFAULT_DENO_DOCKER_TAG = '2.9.5'
// The REST default `WebServerManager.getEnvPort` (`server/src/modules/webserver/manager.ts`)
// falls back to when neither `PORT_<TYPE>` nor `PORT` is set.
const DEFAULT_PORT = 8000
// Same value `server.ts`/`space.ts` (this CLI's own `zanix new` scaffold templates) already
// duplicate locally as `'./.dist/client'` — no leading `./` here, unlike there: a `COPY` path
// doesn't need it, and `/app/./.dist/client` would be a needlessly ugly (if still valid) path.
const CLIENT_BUILD_DIR = '.dist/client'

/**
 * Generates a `Dockerfile` for containerized deployment — one destination option among several
 * (see `docs/deploy.md`), never the assumed default. `'server'`, `'space'`, `'space-server'`, and
 * `'app'` produce a real file; `'library'` is skipped, with a warning — it has nothing that ever
 * calls `Deno.serve()`, standalone or otherwise.
 *
 * The `space`/`space-server` variant additionally installs real npm dependencies (`nodeModulesDir:
 * 'auto'` — Vite, `@vitejs/plugin-react`, Tailwind, `sharp`) and runs this project's own `deno task
 * build` (`baseZnxConfig`'s own `tasks.build: 'zanix space build'`, `space`/`space-server` only) to
 * produce `${CLIENT_BUILD_DIR}` before the runtime stage — never a second, independently-maintained
 * `deno run -A jsr:@zanix/cli space build` invocation that could drift from the task's own flags.
 * The `zanix` binary itself isn't on PATH in a fresh `denoland/deno` image, so the build stage
 * installs it first via the REAL, documented `/setup` script (`README.md`'s own "Installation"
 * section) — never a bare `deno install -A -g -n zanix jsr:@zanix/cli`: that skips `setup.ts`'s own
 * `--config` propagation (the target version's own published `imports`/`nodeModulesDir`, filtered
 * and passed to `deno install --config`), which a genuine global install needs to resolve deep npm
 * dependencies against the served project's own vendored tree instead of Deno's flat global cache.
 * Pinned to this CLI's own currently-running version, read via {@linkcode readModuleConfig} (the
 * `${CLI_INSTALL}` template placeholder below) — never left unpinned: a bare `jsr:@zanix/cli`
 * silently tracks whatever is "latest stable" on JSR the moment the image is built, with no way to
 * reproduce an older build.
 *
 * `'server'` and `'app'` share the SAME `dockerfile.process.base` template — structurally identical
 * (`FROM`/`WORKDIR`/`ENV`/`COPY`/`EXPOSE`/`CMD ["task", ...]`), differing only in which file gets
 * cached and which task the `CMD` runs: `${MAIN_MODULE}`/`start` for `'server'`, `${SERVE_MODULE}`/
 * `serve` for `'app'`. A Zanix App's own `mod.ts` is manifest-only (never a runnable entrypoint),
 * so `'app'` needs a REAL entrypoint to point the `CMD` at — this ALSO scaffolds `${SERVE_MODULE}`
 * (via {@link createAppServeEntrypoint}) and ensures a matching `serve` task exists in this
 * project's own `deno.json` (via {@link ensureAppServeTask}), both non-destructive: neither ever
 * overwrites a file/task the author may have since customized. Reusing one template (rather than a
 * second, near-duplicate file) means the two variants can never drift apart on anything BUT those
 * two substituted values — exactly the same reasoning `CMD ["task", ...]` itself already applies
 * to permission flags.
 *
 * @param options The create file options.
 *   - `baseRoot`: The base root directory where the `Dockerfile` should be created. Defaults to root.
 *   - `projectType`: The Zanix project type the Dockerfile should be generated for. Defaults to `'server'`.
 */
export async function createDockerfile(
  options: DockerfileOptions = {},
): Promise<boolean> {
  const { projectType = 'server', ...opts } = options
  const isSpaceType = projectType === 'space' || projectType === 'space-server'
  const isAppType = projectType === 'app'
  const variant = isSpaceType ? 'space' : projectType === 'server' || isAppType ? 'process' : null

  if (!variant) {
    logger.warn(
      `No Dockerfile template for project type '${projectType}', skipping creation.`,
      'noSave',
    )
    return false
  }

  if (isAppType) {
    await Promise.all([
      createAppServeEntrypoint(opts),
      ensureAppServeTask(opts.baseRoot),
    ])
  }

  const entrypointModule = isAppType ? SERVE_MODULE : MAIN_MODULE
  const taskName = isAppType ? 'serve' : 'start'

  // The REAL, documented install command (`README.md`'s "Installation" section) — never a bare
  // `deno install -A -g -n zanix jsr:@zanix/cli`, which skips `setup.ts`'s own `--config`
  // propagation (see this function's own doc). Pinned to THIS running `cli`'s own version whenever
  // `readModuleConfig` can read it (the normal case, published or local checkout alike — the exact
  // same call `cli.ts` already makes for its own `--version` flag) so a generated Dockerfile always
  // reproduces the same install, never silently drifting to "whatever is latest on JSR today".
  // Falls back to the bare, unpinned `/setup` form (both `[version]` slots default to `cli`'s own
  // published `latest`, per `setup.ts`'s own `LATEST` constant) only in the unlikely case no version
  // could be read — still the real documented command, just unpinned.
  let cliInstallCommand = 'deno run -A jsr:@zanix/cli/setup'
  if (isSpaceType) {
    const { version } = await readModuleConfig(import.meta.url)
    if (version) cliInstallCommand = `deno run -A jsr:@zanix/cli@${version}/setup ${version}`
  }

  return createDockerBaseFile(
    { baseFile: `dockerfile.${variant}.base`, filename: 'Dockerfile', ...opts },
    (content) =>
      content
        .replace(/\$\{DENO_VERSION\}/g, DEFAULT_DENO_DOCKER_TAG)
        .replace(/\$\{PORT\}/g, String(DEFAULT_PORT))
        .replace(/\$\{ENTRYPOINT_MODULE\}/g, entrypointModule)
        .replace(/\$\{TASK_NAME\}/g, taskName)
        .replace(/\$\{CLIENT_BUILD_DIR\}/g, CLIENT_BUILD_DIR)
        .replace(/\$\{CLI_INSTALL\}/g, cliInstallCommand),
  )
}
