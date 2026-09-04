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
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { notFoundCatalogKeys, notFoundTemplate } from 'commands/generate/not-found/template.ts'

async function generateNotFoundAction(
  this: Commander,
  options: unknown,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'not-found', root)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // Unlike `layout`/`error`/`loading`, `not-found.tsx` is a whole-app singleton — always written
  // at the routes root, never under a route-path (`loadRoutes()`'s own `resolveRootSingleton`
  // rule: the first directory in `routesDir` to declare one wins, app-wide).
  const routesFolder = `${projectRoot}/src/space/routes`
  const theme = getProjectTheme(root)
  const renderer = getProjectRenderer(root)
  const messageLangs = getProjectMessageLangs(root)

  const tree: ZanixFolderGenericTree = {
    FOLDER: routesFolder,
    templates: {
      base: [
        {
          PATH: `${routesFolder}/not-found.tsx`,
          NAME: 'not-found.tsx',
          content: () => Promise.resolve(notFoundTemplate(theme, renderer, messageLangs)),
        },
      ],
    },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')
  // Only when the project already has `messages/` — the translated variant imports IntlProvider/
  // useIntl, which the plain (non-i18n) template never needs at all.
  if (messageLangs?.length) {
    await ensureZanixDependency(root, '@zanix/space-ui')
    await mergeMessageKeys(projectRoot, messageLangs, (lang) => notFoundCatalogKeys(theme, lang))
  }

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info("Not-found file created successfully in 'routes/not-found.tsx'.")
}

export default generateNotFoundAction

export function registerNotFoundCommand(cwd: Commander): void {
  cwd.command('not-found')
    .description(
      'Generate the whole-app not-found view (routes/not-found.tsx) — a single, project-wide ' +
        'file, not per-route. Falls back to a built-in default view if never generated.',
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('[root:string]')
    .action((options, ...args) => {
      return generateNotFoundAction.call(cwd, options, ...args)
    })
}
