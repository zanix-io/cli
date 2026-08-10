import type { Commander } from 'cli'

import { getConfigDir, readConfig } from '@zanix/helpers'

/**
 * Reads the `zanix.project` type of the Zanix project rooted at `root` (defaults to `Deno.cwd()`),
 * or `undefined` if no config file exists or it can't be parsed.
 */
export function getCurrentProjectType(root?: string): string | undefined {
  const configPath = getConfigDir(root)
  if (!configPath) return undefined

  try {
    return readConfig(configPath).zanix?.project
  } catch {
    return undefined
  }
}

/**
 * Throws a clear error (via `this.throw`) unless the current project's `zanix.project` type is one
 * of `allowed`.
 */
export function assertProjectType(
  cwd: Commander,
  allowed: string[],
  generatorName: string,
  root?: string,
): void {
  const projectType = getCurrentProjectType(root)

  if (!projectType || !allowed.includes(projectType)) {
    const allowedList = allowed.map((type) => `'${type}'`).join(' or ')
    cwd.throw(
      new Error(`The '${generatorName}' generator must be run inside a ${allowedList} project.`),
    )
  }
}
