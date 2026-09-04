import type { ZanixTemplates } from 'typings/tree.ts'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { formatGeneratedProject, verifyGeneratedProject } from 'utils/verify.ts'
import { assertSafeProjectName } from 'utils/projects/validate-name.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix new app`'s real orchestration: rejects a `..` path-traversal segment in `appName`
 * (`assertSafeProjectName`) and resolves `--template` against `getZanixPaths` (either failure
 * routes through `this.throw`, before anything is written), writes the tree,
 * saves `deno.json`'s Zanix config, formats the whole generated project (`formatGeneratedProject`
 * — unconditional, unlike `--verify`; see its own doc), then — both independently opt-in, off by
 * default — `--verify`s the generated project and/or `--prepare`s it (`zanix prepare <name>
 * --project-type=app -g -e`, unless `--no-prepare` was passed).
 */
async function newAppAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean; verify?: boolean },
  appName: string = 'my-zanix-app',
) {
  const projectType = 'app'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  try {
    assertSafeProjectName(appName)
    structure = getZanixPaths(projectType, appName, template)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)

  await saveZanixConfig(projectType, appName)
  await formatGeneratedProject(structure.FOLDER)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [
      appName,
      `--project-type=${projectType}`,
      '-g',
      '-e',
    ])
  }

  logger.info(
    `App created sucessfully in the '${appName}' folder using the '${template}' template.`,
  )
}

export default newAppAction
