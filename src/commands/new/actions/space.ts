import type { ZanixTemplates } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import { assertValidRenderer } from 'commands/new/lib/renderer.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/logger'

/**
 * `zanix new space`'s real orchestration: validates `--renderer` (`assertValidRenderer` — an
 * unsupported value routes through `this.throw`, same as an unknown `--template`, both before
 * anything is written), resolves the tree, writes it, then
 * `ensureSpaceScaffoldSideEffects`, saves `deno.json`'s Zanix config, then — both independently
 * opt-in, off by default — `--verify`s the generated project and/or `--prepare`s it (`zanix
 * prepare <name> --project-type=space -g -e`, unless `--no-prepare` was passed).
 */
async function newSpaceAction(
  this: Commander,
  options: {
    template: ZanixTemplates
    renderer?: string
    prepare?: boolean
    verify?: boolean
  },
  appName: string = 'my-zanix-space',
) {
  const projectType = 'space'
  const { template, prepare, verify } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  let renderer: 'react' | 'preact'
  try {
    renderer = assertValidRenderer(options.renderer)
    structure = getZanixPaths(projectType, appName, template, renderer)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, template)
  await ensureSpaceScaffoldSideEffects(structure.FOLDER, template)

  await saveZanixConfig(projectType, appName, renderer)

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
    `Space app created sucessfully in the '${appName}' folder using the '${template}' ` +
      `template (renderer: '${renderer}').`,
  )
}

export default newSpaceAction
