import type { ZanixFolderTree, ZanixProjectsFull } from '@zanix/types'

import { MAIN_MODULE } from '@zanix/utils/constants'
import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'

let commonTree: ZanixFolderTree | undefined

export const getCommonTree = (root: string, type?: ZanixProjectsFull): ZanixFolderTree => {
  if (root === commonTree?.FOLDER) return commonTree

  const mainFiles = ['README.md', 'CHANGELOG.md', 'LICENSE']
  if (type === 'library') mainFiles.push(MAIN_MODULE)

  commonTree = ZanixTree.create<ZanixFolderTree>(root, {
    templates: { base: { files: mainFiles, jsr: '@zanix/utils' } },
    subfolders: {
      '.dist': {},
      docs: { templates: { base: { files: ['see-more.md'], jsr: '@zanix/utils' } } },
      src: {
        subfolders: {
          '@tests': {
            subfolders: {
              integration: {
                templates: { base: { files: ['example.test.ts'], jsr: '@zanix/utils' } },
              },
              unit: { templates: { base: { files: ['example.test.ts'], jsr: '@zanix/utils' } } },
              functional: {
                templates: { base: { files: ['example.test.ts'], jsr: '@zanix/utils' } },
              },
            },
          },
          shared: { subfolders: {} },
          typings: { templates: { base: { files: ['index.d.ts'], jsr: '@zanix/utils' } } },
          utils: { templates: { base: { files: ['example.ts'], jsr: '@zanix/utils' } } },
        },
      },
    },
  })

  return commonTree
}
