import type { ZanixProjects } from '@zanix/types'

import { getConfigDir, readConfig, saveConfig } from '@zanix/helpers'
import { configAdaptation } from './adaptation.ts'
import { baseZnxConfig } from './base.ts'
import { CONFIG_FILE } from '@zanix/utils/constants'

/**
 * Write a `deno` base config file for **Zanix** projects
 * @param type - Zanix project type (`server`, `space`, `space-server` or `library`). Defaults to `space-server`
 * @param root - The optional root dir. Defaults to the current working directory's config file
 */
export async function saveZanixConfig(
  type: ZanixProjects = 'space-server',
  root: string | undefined = undefined,
) {
  let config = baseZnxConfig(type)
  const configPath = root !== undefined ? `${root}/${CONFIG_FILE}` : getConfigDir()

  try {
    const currentConfig = readConfig(configPath)
    config = configAdaptation(currentConfig, config)
  } catch {
    // Ignore error
  }

  await saveConfig(config, configPath)
}
