import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureServerScaffoldSideEffects } from 'commands/new/lib/tree/projects/server.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import { assertValidRenderer } from 'commands/new/lib/renderer.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix new spacecraft`'s real orchestration — a `space` frontend + a `server`, in one project.
 * Validates `--renderer` (`assertValidRenderer` — an unsupported value routes through
 * `this.throw`, same as an unknown `--template`, both before anything is written), resolves the
 * combined tree, writes it, then runs BOTH side-effect passes in a fixed order —
 * `ensureServerScaffoldSideEffects` first, then `ensureSpaceScaffoldSideEffects` — saves
 * `deno.json`'s Zanix config, then — both independently opt-in, off by default — `--verify`s the
 * generated project and/or `--prepare`s it (`zanix prepare <name> --project-type=space-server -g
 * -e`, unless `--no-prepare` was passed).
 */
async function newSpacecraftAction(
  this: Commander,
  options: {
    template: ZanixTemplates
    renderer?: string
    prepare?: boolean
    verify?: boolean
  },
  projectName = 'my-zanix-spacecraft',
) {
  const projectType = 'space-server'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  let renderer: 'react' | 'preact'
  try {
    renderer = assertValidRenderer(options.renderer)
    structure = getZanixPaths(projectType, projectName, template, renderer)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)
  await ensureServerScaffoldSideEffects(structure.FOLDER, template)
  await ensureSpaceScaffoldSideEffects(structure.FOLDER, template)

  await saveZanixConfig(projectType, projectName, renderer)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [
      projectName,
      `--project-type=${projectType}`,
      '-g',
      '-e',
    ])
  }

  logger.info(
    `Spacecraft created sucessfully in the '${projectName}' folder using the '${template}' ` +
      `template (renderer: '${renderer}').`,
  )
}

export default newSpacecraftAction
