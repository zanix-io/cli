import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorRoutePath } from 'commands/generate/shared/safe-name.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { loadingTemplate } from 'commands/generate/loading/template.ts'

async function generateLoadingAction(
  this: Commander,
  options: unknown,
  routePath: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'loading', root)
  assertSafeGeneratorRoutePath(this, routePath)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // Same reasoning as `layout/command.ts`: the route path is written verbatim as the folder
  // structure, never reshaped — it determines which segment this Suspense fallback wraps.
  const loadingFolder = `${projectRoot}/src/space/routes/${routePath}`
  const pascalName = pascalNameFromRoutePath(routePath)

  const tree: ZanixFolderGenericTree = {
    FOLDER: loadingFolder,
    templates: {
      base: [
        {
          PATH: `${loadingFolder}/loading.tsx`,
          NAME: 'loading.tsx',
          content: () => Promise.resolve(loadingTemplate(pascalName)),
        },
      ],
    },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Loading file created successfully in 'routes/${routePath}/loading.tsx'.`,
  )
}

export default generateLoadingAction

export function registerLoadingCommand(cwd: Commander): void {
  cwd.command('loading')
    .description(
      'Generate a segment Suspense fallback (routes/<route-path>/loading.tsx) — e.g. ' +
        "'products'. React-only: @zanix/space rejects this file at route-registration time " +
        'under `--renderer=preact` (Preact core has no Suspense).',
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<route-path:string> [root:string]')
    .action((options, ...args) => {
      return generateLoadingAction.call(cwd, options, ...args)
    })
}
