import type { DockerfileOptions } from 'commands/prepare/lib/typings.ts'

import { MAIN_MODULE } from '@zanix/utils/constants'
import { createDockerBaseFile } from 'commands/prepare/lib/docker/files/base.ts'
import {
  createAppServeEntrypoint,
  ensureAppServeTask,
  SERVE_MODULE,
} from 'commands/prepare/lib/docker/files/app-entrypoint.ts'
import logger from '@zanix/logger'

// Verified against the real, currently-published `denoland/deno` Docker Hub/GHCR tags at the time
// this was written — the debian-based default variant, not `alpine`: `sharp` (a real npm dep of
// `@zanix/space`) ships a native prebuilt binary that depends on glibc, and alpine/musl support
// isn't guaranteed across every platform it publishes for. Bump this one constant when a newer
// Deno major/minor is worth tracking — never duplicated anywhere else.
const DEFAULT_DENO_DOCKER_TAG = '2.9.5'
// The REST default `WebServerManager.getEnvPort` (`server/src/modules/webserver/manager.ts`)
// falls back to when neither `PORT_<TYPE>` nor `PORT` is set.
const DEFAULT_PORT = 8000
// Same value `server.ts`/`space.ts` (this CLI's own `zanix new` scaffold templates) already
// duplicate locally as `'./dist/client'` — no leading `./` here, unlike there: a `COPY` path
// doesn't need it, and `/app/./dist/client` would be a needlessly ugly (if still valid) path.
const CLIENT_BUILD_DIR = 'dist/client'

/**
 * Generates a `Dockerfile` for containerized deployment — one destination option among several
 * (see `docs/DEPLOY.md`), never the assumed default. `'server'`, `'space'`, `'space-server'`, and
 * `'app'` produce a real file; `'library'` is skipped, with a warning — it has nothing that ever
 * calls `Deno.serve()`, standalone or otherwise.
 *
 * The `space`/`space-server` variant additionally installs real npm dependencies (`nodeModulesDir:
 * 'auto'` — Vite, `@vitejs/plugin-react`, Tailwind, `sharp`) and runs `zanix space build` to
 * produce `${CLIENT_BUILD_DIR}` before the runtime stage — there is no `deno.json` `build` task to
 * invoke instead (`baseZnxConfig` only ever writes `dev`/`start`), so the template calls the CLI
 * directly (`deno run -A jsr:@zanix/cli space build`).
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

  return createDockerBaseFile(
    { baseFile: `dockerfile.${variant}.base`, filename: 'Dockerfile', ...opts },
    (content) =>
      content
        .replace(/\$\{DENO_VERSION\}/g, DEFAULT_DENO_DOCKER_TAG)
        .replace(/\$\{PORT\}/g, String(DEFAULT_PORT))
        .replace(/\$\{ENTRYPOINT_MODULE\}/g, entrypointModule)
        .replace(/\$\{TASK_NAME\}/g, taskName)
        .replace(/\$\{CLIENT_BUILD_DIR\}/g, CLIENT_BUILD_DIR),
  )
}
