import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { formatGeneratedProject, verifyGeneratedProject } from 'utils/verify.ts'
import { assertSafeProjectName } from 'utils/projects/validate-name.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix new library`'s real orchestration: rejects a `..` path-traversal segment in
 * `libraryName` (`assertSafeProjectName`) and resolves `--template` against `getZanixPaths`
 * (either failure routes through `this.throw`, before anything is written), writes the
 * tree, saves `deno.json`'s Zanix config, formats the whole generated project
 * (`formatGeneratedProject` — unconditional, unlike `--verify`), then — both independently
 * opt-in, off by default — `--verify`s the generated project and/or `--prepare`s it (`zanix
 * prepare <name> --project-type=library -g -e`, unless `--no-prepare` was passed).
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
    assertSafeProjectName(libraryName)
    structure = getZanixPaths(projectType, libraryName, template)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)

  await saveZanixConfig(projectType, libraryName)
  await formatGeneratedProject(structure.FOLDER)

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
