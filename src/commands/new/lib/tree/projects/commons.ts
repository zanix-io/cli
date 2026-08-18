import type { ZanixFolderTree, ZanixProjectsFull } from '@zanix/types'

import { MAIN_MODULE } from '@zanix/utils/constants'
import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'

let commonTree: ZanixFolderTree | undefined
let commonTreeKey: string | undefined

/**
 * The root-level tree shared by every project type — `README.md`/`CHANGELOG.md`/`LICENSE`, an
 * empty `.dist/`, `docs/see-more.md`, and `src/{@tests,shared,typings,utils}`'s own starter
 * content. Every project type's own tree builder (`getServerSrcTree`, `getSpaceSrcTree`,
 * `getLibrarySrcTree`) composes this at its root, then adds its own type-specific subtree on top.
 *
 * @param root - The project's root directory.
 * @param type - The Zanix project type being scaffolded. Only affects whether `mainFiles`
 * includes `MAIN_MODULE` (`library` only, since a library's `mod.ts` lives at the project root,
 * unlike `server`/`space`'s own `src/{server,space}`-rooted entrypoints) — see the cache-key
 * comment below for why this parameter matters for correctness, not just content.
 */
export const getCommonTree = (
  root: string,
  type?: ZanixProjectsFull,
): ZanixFolderTree => {
  // Cache key includes `type`, not just `root` — without it, calling this with the same `root`
  // but a different `type` (e.g. a `library` project followed by an `app` project scaffolded
  // into the same path) would silently return the first call's stale tree, since `type` alone
  // decides whether `mainFiles` includes `MAIN_MODULE` (see below).
  const cacheKey = `${root}::${type}`
  if (commonTree && commonTreeKey === cacheKey) return commonTree

  const mainFiles = ['README.md', 'CHANGELOG.md', 'LICENSE']
  if (type === 'library') mainFiles.push(MAIN_MODULE)

  commonTreeKey = cacheKey
  commonTree = ZanixTree.create<ZanixFolderTree>(root, {
    templates: { base: { files: mainFiles, jsr: '@zanix/utils' } },
    subfolders: {
      '.dist': {},
      docs: {
        templates: { base: { files: ['see-more.md'], jsr: '@zanix/utils' } },
      },
      src: {
        subfolders: {
          '@tests': {
            subfolders: {
              integration: {
                templates: {
                  base: { files: ['example.test.ts'], jsr: '@zanix/utils' },
                },
              },
              unit: {
                templates: {
                  base: { files: ['example.test.ts'], jsr: '@zanix/utils' },
                },
              },
              functional: {
                templates: {
                  base: { files: ['example.test.ts'], jsr: '@zanix/utils' },
                },
              },
            },
          },
          shared: { subfolders: {} },
          typings: {
            templates: { base: { files: ['index.d.ts'], jsr: '@zanix/utils' } },
          },
          utils: {
            templates: { base: { files: ['example.ts'], jsr: '@zanix/utils' } },
          },
        },
      },
    },
  })

  return commonTree
}
