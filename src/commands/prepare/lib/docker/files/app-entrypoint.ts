import type { BaseDockerHelperOptions } from 'commands/prepare/lib/typings.ts'

import { createDockerBaseFile } from './base.ts'
import { RUN_PERMISSIONS } from 'utils/config/base.ts'
import { getConfigDir, readConfig, saveConfig } from '@zanix/helpers'
import logger from '@zanix/logger'

/** The standalone remote entrypoint's own filename — distinct from `MAIN_MODULE` (`'mod.ts'`,
 * the manifest-only export every Zanix App already has). Read by `createDockerfile`'s own `'app'`
 * variant to interpolate into the generated Dockerfile's `CMD`. */
export const SERVE_MODULE = 'serve.ts'

/**
 * Scaffolds `${SERVE_MODULE}` for an `'app'` project — a real, standalone `bootstrapRemoteApp`
 * entrypoint, since `zanix new app` never generates one (a Zanix App is an installable manifest
 * first; most never need to run standalone at all). Only called from `createDockerfile`'s own
 * `'app'` variant, since a Dockerfile pointing at a file this doesn't create would be useless.
 *
 * Same non-destructive convention every other file this command writes already follows (via
 * {@link createDockerBaseFile}): skipped, with a warning, if `${SERVE_MODULE}` already exists —
 * never overwrites a file the author may have since customized (a real `remoteInstances` endpoint,
 * extra `resources`/`uses`, etc.).
 *
 * @param options Same shape `createDockerfile`/`createDockerignoreFile` accept — `baseRoot` is the
 * only field actually used here.
 */
export function createAppServeEntrypoint(
  options: BaseDockerHelperOptions = {},
): Promise<boolean> {
  return createDockerBaseFile({
    baseFile: 'serve.app.base',
    filename: SERVE_MODULE,
    ...options,
  })
}

/**
 * Ensures a `serve` task exists in this `'app'` project's own `deno.json`/`deno.jsonc`, so the
 * generated Dockerfile's `CMD ["task", "serve"]` (see `createDockerfile`'s own doc) has something
 * real to run — `baseZnxConfig` never gives `'app'` a task at `zanix new` time (its `mod.ts` is
 * manifest-only), so this is the one place that adds it, on-demand, once an app opts into
 * standalone deployment via `--docker`.
 *
 * A SURGICAL merge — reads the existing config, adds ONLY `tasks.serve` if that key isn't already
 * present, and writes the rest back completely untouched. Deliberately NOT
 * `saveZanixConfig`/`configAdaptation` (the machinery `zanix new` itself uses to regenerate a
 * config): that path resets several other fields to their base defaults on every call (`fmt`'s
 * `indentWidth`/`lineWidth`/`singleQuote`/`semiColons`, overlapping `imports` keys) — appropriate
 * for `zanix new`'s own re-scaffold flow, but far more than a `--docker` run should ever touch on
 * an already-customized project.
 *
 * Shares `RUN_PERMISSIONS` with `baseZnxConfig`'s own `start`/`worker` tasks (`utils/config/
 * base.ts`) — one source of truth, so a `'server'` project's `start` task and an `'app'` project's
 * `serve` task can never drift apart on permissions.
 *
 * **Known limitation, same as `saveZanixConfig`'s own underlying `readConfig`/`saveConfig`
 * round-trip**: writes back via `JSON.stringify`, which does not preserve comments in an existing
 * `deno.jsonc` — an accepted, pre-existing tradeoff of this config-writing pipeline, not something
 * new to this function.
 *
 * @param baseRoot The project root directory — defaults to `getConfigDir()`'s own default (the
 * current working directory) when omitted, same as every other helper in this file.
 */
export async function ensureAppServeTask(baseRoot?: string): Promise<boolean> {
  const configPath = getConfigDir(baseRoot)

  if (!configPath) {
    logger.warn(
      `No deno.json/deno.jsonc found in '${baseRoot ?? '.'}', skipping 'serve' task.`,
      'noSave',
    )
    return false
  }

  const config = readConfig(configPath)

  if (config.tasks?.serve) {
    logger.warn(
      `'serve' task already exists in '${configPath}', skipping.`,
      'noSave',
    )
    return false
  }

  config.tasks = {
    ...config.tasks,
    serve: `deno run --env-file=.env ${RUN_PERMISSIONS} ${SERVE_MODULE}`,
  }

  await saveConfig(config, configPath)
  logger.success(`'serve' task added to '${configPath}'!`)

  return true
}
