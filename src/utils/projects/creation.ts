import type { ZanixFolderGenericTree } from '@zanix/types'

import { fileExists, folderExists } from '@zanix/helpers'
import { dirname } from '@std/path'

export function createFilesAndFolders(obj: ZanixFolderGenericTree, template: 'base') {
  // Create folder if it does not exist and if has files or subfolders inside
  const existFolder = obj.FOLDER && !folderExists(obj.FOLDER)
  const selectedTemplate = obj.templates?.[template]
  const hasContent = selectedTemplate || obj.subfolders
  if (existFolder && hasContent) {
    // deno-lint-ignore no-non-null-assertion
    Deno.mkdirSync(obj.FOLDER!, { recursive: true })
  }

  if (selectedTemplate) {
    for (const file of selectedTemplate) {
      const filePath = file.PATH
      if (!filePath) continue

      const folderPath = dirname(filePath)

      Deno.mkdirSync(folderPath, { recursive: true })

      // Create example file
      if (!fileExists(filePath)) {
        file.content({ metaUrl: import.meta.url }).then(
          (text) => Deno.writeTextFile(filePath, text),
        )
      }
    }
  }

  // Subfolders recoursivity
  if (obj.subfolders) {
    for (const folderName in obj.subfolders) {
      const subfolder = obj.subfolders[folderName]
      createFilesAndFolders(subfolder, template)
    }
  }
}
