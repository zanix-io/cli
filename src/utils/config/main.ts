import type { ZanixProjects } from '@zanix/types'

import { getConfigDir, readConfig, saveConfig } from '@zanix/helpers'
import { configAdaptation } from './adaptation.ts'
import { baseZnxConfig } from './base.ts'
import { CONFIG_FILE } from '@zanix/utils/constants'

/**
 * Write a `deno` base config file for **Zanix** projects
 * @param type - Zanix project type (`app`, `server`, `space`, `space-server` or `library`). Defaults to `space-server`
 * @param root - The optional root dir. Defaults to the current working directory's config file
 * @param renderer - `--renderer`'s own value — forwarded to {@linkcode baseZnxConfig} unchanged,
 * ignored for any `type` other than `space`/`space-server`. Defaults to `'react'`, identical in
 * every respect to passing it explicitly.
 */
export async function saveZanixConfig(
  type: ZanixProjects = 'space-server',
  root: string | undefined = undefined,
  renderer: 'react' | 'preact' = 'react',
) {
  let config = baseZnxConfig(type, renderer)
  const configPath = root !== undefined ? `${root}/${CONFIG_FILE}` : getConfigDir()

  try {
    const currentConfig = readConfig(configPath)
    config = configAdaptation(currentConfig, config)
  } catch (error) {
    // Only a missing config file is expected/benign here (the common case: `zanix new` scaffolding
    // a brand-new project with nothing at `configPath` yet) — `readConfig`'s own "not found" throws
    // either a plain `Error` (no `configPath` resolved at all) or `Deno.errors.NotFound` (a real
    // `configPath` given, but nothing at that path). Anything else (malformed JSON, a permission
    // error) must NOT be silently swallowed — doing so would overwrite the user's own existing,
    // just-unreadable config with a fresh base one, with no warning at all.
    const isMissingConfig = error instanceof Deno.errors.NotFound ||
      (error instanceof Error && error.message.startsWith('Configuration file not found'))
    if (!isMissingConfig) throw error
  }

  await saveConfig(config, configPath)
}
