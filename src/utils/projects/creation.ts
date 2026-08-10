import type { ZanixFolderGenericTree } from '@zanix/types'

import { fileExists, folderExists } from '@zanix/helpers'
import { dirname } from '@std/path'

/**
 * Ensures `constantName` is declared in `filePath`, appending `declaration` if it's missing —
 * creates the file (and its folder) from scratch when it doesn't exist yet at all. Unlike
 * `createFilesAndFolders`'s whole-file "never overwrite" guard, this targets a single constant
 * inside a file that may already have unrelated content (e.g. a project's own
 * `src/utils/constants.ts`), so a generator needing one (like `IsObjectID.ts`'s `OBJECTID_REGEX`)
 * doesn't clobber whatever's already there.
 *
 * A plain substring check for `constantName` — conservative on purpose: it may skip appending in
 * an unlikely false-positive (the name appearing in a comment), but it will never duplicate the
 * declaration, which is the failure mode that actually matters here.
 */
export async function ensureConstant(
  filePath: string,
  constantName: string,
  declaration: string,
): Promise<void> {
  if (!fileExists(filePath)) {
    await Deno.mkdir(dirname(filePath), { recursive: true })
    await Deno.writeTextFile(filePath, `${declaration}\n`)
    return
  }

  const content = await Deno.readTextFile(filePath)
  if (content.includes(constantName)) return

  const separator = content.endsWith('\n') ? '' : '\n'
  await Deno.writeTextFile(filePath, `${content}${separator}${declaration}\n`)
}

export async function createFilesAndFolders(
  obj: ZanixFolderGenericTree,
  template: 'base',
): Promise<void> {
  // Create folder if it does not exist and if has files or subfolders inside
  const existFolder = obj.FOLDER && !folderExists(obj.FOLDER)
  const selectedTemplate = obj.templates?.[template]
  const hasContent = selectedTemplate || obj.subfolders
  if (existFolder && hasContent) {
    // deno-lint-ignore no-non-null-assertion
    await Deno.mkdir(obj.FOLDER!, { recursive: true })
  }

  const pending: Promise<unknown>[] = []

  if (selectedTemplate) {
    const folderPaths = new Set<string>()
    for (const file of selectedTemplate) {
      if (file.PATH) folderPaths.add(dirname(file.PATH))
    }
    await Promise.all(
      [...folderPaths].map((folderPath) => Deno.mkdir(folderPath, { recursive: true })),
    )

    for (const file of selectedTemplate) {
      const filePath = file.PATH
      if (!filePath) continue

      // Create example file
      if (!fileExists(filePath)) {
        pending.push(
          file.content({ metaUrl: import.meta.url }).then(
            (text) => Deno.writeTextFile(filePath, text),
          ),
        )
      }
    }
  }

  // Subfolders recoursivity
  if (obj.subfolders) {
    for (const folderName in obj.subfolders) {
      const subfolder = obj.subfolders[folderName]
      pending.push(createFilesAndFolders(subfolder, template))
    }
  }

  await Promise.all(pending)
}
