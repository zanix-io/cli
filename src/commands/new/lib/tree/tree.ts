import type { ZanixFolderTree, ZanixProjectsFull } from 'typings/tree.ts'

import { getZnxFolderTree } from 'commands/new/lib/tree/projects/main.ts'
import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import type { RendererName } from 'commands/new/lib/renderer.ts'
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
 * @param projectDir - The custom project dir `cwd`. Defaults to initial root. A `zanix new <type>`
 * action passes its own `<name>` positional argument here directly — checked for a `..`
 * path-traversal segment at that call site (`assertSafeProjectName`,
 * `utils/projects/validate-name.ts`) before it ever reaches this function; this function itself
 * applies no such check, so any other caller (a test fixture pointing generation at an isolated
 * temp directory, for instance) can still pass an arbitrary absolute/nested path.
 * @param preset - `--template`'s own value. Defaults to `'base'` — see `getZnxFolderTree`'s own
 * doc for why that default must always match the CLI option's own default.
 * @param renderer - `--renderer`'s own value — forwarded to {@linkcode getZnxFolderTree} unchanged,
 * only ever consulted for `type === 'space' | 'space-server'`.
 * @param theme - `--theme`'s own value — forwarded to {@linkcode getZnxFolderTree} unchanged, same
 * consultation rule as `renderer`. Independent of `preset` — see `themes.ts`'s own doc. `--icons`
 * has no equivalent parameter here on purpose: it no longer affects this tree at all — see
 * `getSpaceAppTemplate`'s own doc (`space.ts`) for why `assetsDir` is unconditional now, and
 * `ensureSpaceScaffoldSideEffects`'s own doc for where `--icons`'s real file copy actually happens
 * instead (a separate, imperative side-effect pass, never this declarative tree).
 *
 * @returns A nested object representing the folder structure for the given type.
 */
export function getZanixPaths<
  T extends ZanixProjectsFull = undefined,
>(
  type?: T,
  projectDir?: string,
  preset?: string,
  renderer?: RendererName,
  theme?: ThemeName,
): ZanixFolderTree<T> {
  return getZnxFolderTree(`${projectDir ?? getRootDir()}/`, type, preset, renderer, theme)
}
