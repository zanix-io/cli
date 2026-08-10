import type {
  ZanixBaseFolder,
  ZanixLibraries,
  ZanixLocalContentProps,
  ZanixTemplates,
  ZanixTemplatesRecord,
} from '@zanix/types'

import { getZanixTemplateContent } from 'commands/new/lib/tree/templates.ts'
import { join } from '@std/path'
import { getFolderName } from '@zanix/helpers'

// Not part of `@zanix/types`'s public surface — private to this tree-building mechanism, moved
// here verbatim alongside `ZanixTree`/`BaseZanixTree`, its only consumer.
type ZanixFolderOptions = {
  templates: {
    [name in ZanixTemplates]: {
      files: string[]
      jsr?: keyof ZanixLibraries
    }
  }
}

type ZanixSubfolderOptions<S> = S extends { subfolders: infer U }
  ? U extends Record<string, unknown>
    ? { subfolders: { [K in keyof U]: ZanixTreeFolderOptions<U[K]> } }
  : object
  : object

// deno-lint-ignore ban-types
type ZanixTemplateOptions<S> = S extends { templates: unknown } ? ZanixFolderOptions : {}

type ZanixTreeFolderOptions<S> = ZanixSubfolderOptions<S> & ZanixTemplateOptions<S>

class BaseZanixTree<S extends ZanixBaseFolder> {
  #baseName: string
  constructor(root: string, private baseRoot: string) {
    this.#baseName = getFolderName(root)
  }

  /**
   * Function to create multiple folders structure
   * @param folders
   */
  // deno-lint-ignore no-explicit-any
  public generateTreeFolder(tree: any, path: string): S {
    path = join(path, tree.NAME || '')

    Object.assign(tree, this.createFolder({ ...tree, FOLDER: path }))

    if (tree.subfolders) {
      Object.entries<object>(tree.subfolders).forEach(([name, subfolder]) => {
        tree.subfolders[name] = this.generateTreeFolder({
          ...subfolder,
          NAME: name,
        }, path)
      })
    }

    return tree as S
  }

  /**
   * Function to create a folder structure.
   */
  private createFolder(
    options: Partial<ZanixFolderOptions> & { NAME: string; FOLDER: string },
  ): Partial<ZanixBaseFolder> {
    const { NAME = this.#baseName, templates, FOLDER } = options

    if (!templates) return { FOLDER, NAME }

    const baseTemplates = {} as ZanixTemplatesRecord
    Object.entries(templates).forEach(([name, options]) => {
      baseTemplates[name as ZanixTemplates] = this.createTemplates({
        ...options,
        folderPath: FOLDER,
      })
    })

    return {
      FOLDER,
      NAME,
      templates: baseTemplates,
    }
  }

  /**
   * Function to create a template
   */
  private createTemplates(
    options: { files: string[]; folderPath: string; jsr?: keyof ZanixLibraries },
  ) {
    const { files, jsr, folderPath } = options
    const { baseRoot } = this

    return files.map((file) => ({
      PATH: join(folderPath, file),
      NAME: file,
      content(local: ZanixLocalContentProps) {
        const { metaUrl, relativePath = '' } = local
        const relative = jsr ? 'src/templates/' : join(relativePath, '/')
        return getZanixTemplateContent({
          url: metaUrl,
          path: this.PATH.replace(baseRoot, relative),
          jsr,
        })
      },
    }))
  }
}

/**
 * Class to generate a ZanixTreeFolder
 */
export class ZanixTree {
  public static create<S extends Partial<ZanixBaseFolder>>(
    root: string | {
      /**
       * Specifies the main root directory to be used as a starting point.
       * If it differs from the default value, provide the path here (e.g., if it's `src` or any subdirectory).
       */
      startingPoint: string

      /**
       * Path of the root directory. Used to identify the base root directory.
       */
      baseRoot: string
    },
    tree: ZanixTreeFolderOptions<S>,
  ) {
    const { startingPoint, baseRoot } = typeof root === 'string'
      ? { startingPoint: root, baseRoot: root }
      : root

    return new BaseZanixTree(startingPoint, baseRoot).generateTreeFolder(tree, startingPoint) as S
  }
}
