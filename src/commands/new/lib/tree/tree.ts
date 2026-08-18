import type { ZanixFolderTree, ZanixProjectsFull } from '@zanix/types'

import { getZnxFolderTree } from 'commands/new/lib/tree/projects/main.ts'
import { getRootDir } from '@zanix/helpers'

/**
 * Retrieves the recommended folder structure for `Zanix` projects based on the provided type.
 *
 * @template T - A generic type parameter that must extend `ZanixProjects`.
 *
 * @param type - The type of the structure to retrieve.
 *                Use `server` to get the backend API folder structure, `space`
 *                to get the `@zanix/space` frontend folder structure, or `library`.
 *
 *                If you want to get `server` and `space` together, send `space-server` type.
 *
 *                Defaults (undefined) to sending the common structure.
 *
 * @param projectDir - The custom project dir `cwd`. Defaults to initial root.
 * @param preset - `--template`'s own value. Defaults to `'base'` — see `getZnxFolderTree`'s own
 * doc for why that default must always match the CLI option's own default.
 * @param renderer - `--renderer`'s own value — forwarded to {@linkcode getZnxFolderTree} unchanged,
 * only ever consulted for `type === 'space' | 'space-server'`.
 *
 * @returns A nested object representing the folder structure for the given type.
 */
export function getZanixPaths<
  T extends ZanixProjectsFull = undefined,
>(
  type?: T,
  projectDir?: string,
  preset?: string,
  renderer?: 'react' | 'preact',
): ZanixFolderTree<T> {
  return getZnxFolderTree(`${projectDir ?? getRootDir()}/`, type, preset, renderer)
}
