import type { ZanixProjects } from '@zanix/types'

import { getConfigDir, readConfig, saveConfig } from '@zanix/helpers'
import { configAdaptation } from './adaptation.ts'
import { baseZnxConfig } from './base.ts'
import { CONFIG_FILE } from '@zanix/utils/constants'

/**
 * Write a `deno` base config file for **Zanix** projects
 * @param type - Zanix project type (`server`, `app`, `app-server` or `library`)
 * @param root - The optional root dir
 *
 *               Defaults to `app-server`
 */
export async function saveZanixConfig(
  type: ZanixProjects = 'app-server',
  root: string | undefined = undefined,
) {
  //TODO: review zanix hash on config project name changes
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
