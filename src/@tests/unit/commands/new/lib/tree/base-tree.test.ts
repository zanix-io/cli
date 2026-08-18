// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertExists } from '@std/assert'
import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'

Deno.test('CreateZanixTree should return the correct folder with current level', () => {
  const tree = ZanixTree.create<
    {
      subfolders: {
        'folder-level-2': any
        'new-folder-level-2': {
          NAME: string
          FOLDER: string
          templates: any
          subfolders: {
            'folder-level-3': any
            'new-folder-level-3': any
          }
        }
      }
      FOLDER: string
      NAME: string
      templates: any
    }
  >('this-is-my-root', {
    templates: { base: { files: ['fileA'] } },
    subfolders: {
      'folder-level-2': {
        templates: { base: { files: ['fileB'] } },
      },
      'new-folder-level-2': {
        templates: { base: { files: ['fileC'] } },
        subfolders: {
          'folder-level-3': {
            templates: { base: { files: ['fileD'] } },
          },
          'new-folder-level-3': {
            templates: { base: { files: ['fileE'] } },
          },
        },
      },
    },
  })

  assertEquals(tree.FOLDER, 'this-is-my-root')
  assertEquals(tree.NAME, 'this-is-my-root')
  assertEquals(tree.templates.base[0].PATH, 'this-is-my-root/fileA')
  assertEquals(tree.templates.base[0].NAME, 'fileA')
  assertExists(tree.templates.base[0].content)

  const level2 = tree.subfolders

  assertEquals(level2['folder-level-2'].NAME, 'folder-level-2')
  assertEquals(
    level2['folder-level-2'].FOLDER,
    'this-is-my-root/folder-level-2',
  )
  assertEquals(
    level2['folder-level-2'].templates.base[0].PATH,
    'this-is-my-root/folder-level-2/fileB',
  )
  assertEquals(level2['folder-level-2'].templates.base[0].NAME, 'fileB')
  assertExists(level2['folder-level-2'].templates.base[0].content)

  assertEquals(level2['new-folder-level-2'].NAME, 'new-folder-level-2')
  assertEquals(
    level2['new-folder-level-2'].FOLDER,
    'this-is-my-root/new-folder-level-2',
  )
  assertEquals(
    level2['new-folder-level-2'].templates.base[0].PATH,
    'this-is-my-root/new-folder-level-2/fileC',
  )
  assertEquals(level2['new-folder-level-2'].templates.base[0].NAME, 'fileC')
  assertExists(level2['new-folder-level-2'].templates.base[0].content)

  const level3 = level2['new-folder-level-2'].subfolders

  assertEquals(level3['folder-level-3'].NAME, 'folder-level-3')
  assertEquals(
    level3['folder-level-3'].FOLDER,
    'this-is-my-root/new-folder-level-2/folder-level-3',
  )
  assertEquals(
    level3['folder-level-3'].templates.base[0].PATH,
    'this-is-my-root/new-folder-level-2/folder-level-3/fileD',
  )
  assertEquals(level3['folder-level-3'].templates.base[0].NAME, 'fileD')
  assertExists(level3['folder-level-3'].templates.base[0].content)

  assertEquals(level3['new-folder-level-3'].NAME, 'new-folder-level-3')
  assertEquals(
    level3['new-folder-level-3'].FOLDER,
    'this-is-my-root/new-folder-level-2/new-folder-level-3',
  )
  assertEquals(
    level3['new-folder-level-3'].templates.base[0].PATH,
    'this-is-my-root/new-folder-level-2/new-folder-level-3/fileE',
  )
  assertEquals(level3['new-folder-level-3'].templates.base[0].NAME, 'fileE')
  assertExists(level3['new-folder-level-3'].templates.base[0].content)
})
