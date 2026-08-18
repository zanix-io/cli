import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix new library`'s real orchestration: resolves `--template` against `getZanixPaths`
 * (an unknown template routes through `this.throw`, before anything is written), writes the
 * tree, saves `deno.json`'s Zanix config, then — both independently opt-in, off by default —
 * `--verify`s the generated project and/or `--prepare`s it (`zanix prepare <name>
 * --project-type=library -g -e`, unless `--no-prepare` was passed).
 */
async function newLibraryAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean; verify?: boolean },
  libraryName = 'my-zanix-library',
) {
  const projectType = 'library'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  try {
    structure = getZanixPaths(projectType, libraryName, template)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)

  await saveZanixConfig(projectType, libraryName)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [
      libraryName,
      `--project-type=${projectType}`,
      '-g',
      '-e',
    ])
  }

  logger.info(
    `Library created sucessfully in the '${libraryName}' folder using the '${template}' template.`,
  )
}

export default newLibraryAction
