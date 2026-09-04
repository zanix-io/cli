import type { ZanixFolderGenericTree } from 'typings/tree.ts'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import {
  assertProjectType,
  getProjectMessageLangs,
  getProjectRenderer,
  getProjectTheme,
} from 'commands/generate/shared/project.ts'
import { mergeMessageKeys } from 'commands/generate/shared/messages-merge.ts'
import { assertSafeGeneratorRoutePath } from 'commands/generate/shared/safe-name.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { errorCatalogKeys, errorTemplate } from 'commands/generate/error/template.ts'

async function generateErrorAction(
  this: Commander,
  options: unknown,
  routePath: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'error', root)
  assertSafeGeneratorRoutePath(this, routePath)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // Same reasoning as `layout/command.ts`: the route path is written verbatim as the folder
  // structure, never reshaped — it determines which segment this error boundary wraps.
  const errorFolder = `${projectRoot}/src/space/routes/${routePath}`
  const pascalName = pascalNameFromRoutePath(routePath)
  const renderer = getProjectRenderer(root)
  const theme = getProjectTheme(root)
  const messageLangs = getProjectMessageLangs(root)

  const tree: ZanixFolderGenericTree = {
    FOLDER: errorFolder,
    templates: {
      base: [
        {
          PATH: `${errorFolder}/error.tsx`,
          NAME: 'error.tsx',
          content: () => Promise.resolve(errorTemplate(pascalName, renderer, theme, messageLangs)),
        },
      ],
    },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')
  await ensureZanixDependency(root, '@zanix/space-ui')
  // Only when the project already has `messages/` — seeds the exact keys the generated
  // `formatMessage(...)` calls read (`errorCatalogKeys`), never overwriting a key it already has.
  if (messageLangs?.length) {
    await mergeMessageKeys(projectRoot, messageLangs, (lang) => errorCatalogKeys(theme, lang))
  }

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Error boundary file created successfully in 'routes/${routePath}/error.tsx'.`,
  )
}

export default generateErrorAction

export function registerErrorCommand(cwd: Commander): void {
  cwd.command('error')
    .description(
      "Generate a segment error boundary (routes/<route-path>/error.tsx) — e.g. 'products'.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<route-path:string> [root:string]')
    .action((options, ...args) => {
      return generateErrorAction.call(cwd, options, ...args)
    })
}
