import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureServerScaffoldSideEffects } from 'commands/new/lib/tree/projects/server.ts'
import { formatGeneratedProject, verifyGeneratedProject } from 'utils/verify.ts'
import { assertSafeProjectName } from 'utils/projects/validate-name.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix new server`'s real orchestration: rejects a `..` path-traversal segment in `serverName`
 * (`assertSafeProjectName`) and resolves `--template` against `getZanixPaths` (either failure
 * routes through `this.throw`, before anything is written), writes the tree,
 * then `ensureServerScaffoldSideEffects` (every recipe leaf's own side effects — e.g. `seeder`'s
 * shared `src/utils/seeders.ts` helper), saves `deno.json`'s Zanix config, formats the whole
 * generated project (`formatGeneratedProject` — unconditional, unlike `--verify`), then — both
 * independently opt-in, off by default — `--verify`s the generated project and/or `--prepare`s it
 * (`zanix prepare <name> --project-type=server -g -e`, unless `--no-prepare` was passed).
 */
async function newServerAction(
  this: Commander,
  options: { template: ZanixTemplates; prepare?: boolean; verify?: boolean },
  serverName: string = 'my-zanix-server',
) {
  const projectType = 'server'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  try {
    assertSafeProjectName(serverName)
    structure = getZanixPaths(projectType, serverName, template)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)
  await ensureServerScaffoldSideEffects(structure.FOLDER, template)

  await saveZanixConfig(projectType, serverName)
  await formatGeneratedProject(structure.FOLDER)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [
      serverName,
      `--project-type=${projectType}`,
      '-g',
      '-e',
    ])
  }

  logger.info(
    `Server project created sucessfully in the '${serverName}' folder using the '${template}' template.`,
  )
}

export default newServerAction
