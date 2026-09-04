import type { ZanixFolderTree, ZanixProjectsFull } from 'typings/tree.ts'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'

let commonTree: ZanixFolderTree | undefined
let commonTreeKey: string | undefined

/**
 * The root-level tree shared by every project type — `README.md`/`CHANGELOG.md`/`LICENSE`, an
 * empty `.dist/`, `docs/see-more.md`, and `src/{@tests,shared,typings,utils}`'s own starter
 * content. Every project type's own tree builder (`getServerSrcTree`, `getSpaceSrcTree`,
 * `getLibrarySrcTree`) composes this at its root, then adds its own type-specific subtree on top.
 * `library`'s own root `mod.ts` is NOT part of this shared content — `getZnxFolderTree`
 * (`projects/main.ts`) appends it afterward via `getLibraryRootModTemplate`, the same
 * push-after-`getCommonTree` pattern `server`/`space`'s own root `mod.ts` already use, so this
 * function stays identical for every project type regardless of `type`.
 *
 * @param root - The project's root directory.
 * @param type - The Zanix project type being scaffolded. Kept as a parameter for callers/tests
 * that key on it, though it does not affect this function's own output — see `main.ts`'s own
 * per-`type` root-level pushes for where type-specific root content is actually added instead.
 */
export const getCommonTree = (
  root: string,
  type?: ZanixProjectsFull,
): ZanixFolderTree => {
  const cacheKey = `${root}::${type}`
  if (commonTree && commonTreeKey === cacheKey) return commonTree

  const mainFiles = ['README.md', 'CHANGELOG.md', 'LICENSE']

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
