import type { ZanixFolderGenericTree } from 'typings/tree.ts'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorRoutePath } from 'commands/generate/shared/safe-name.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { pageTemplate } from 'commands/generate/page/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface PagePlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface PagePlan {
  files: PagePlanFile[]
}

/** Pure planning for a page: given a pascal name + the target route folder. */
export function planPage(pascalName: string, pageFolder: string): PagePlan {
  return {
    files: [{
      PATH: `${pageFolder}/page.tsx`,
      NAME: 'page.tsx',
      content: () => Promise.resolve(pageTemplate(pascalName)),
    }],
  }
}

async function generatePageAction(
  this: Commander,
  options: unknown,
  routePath: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'page', root)
  assertSafeGeneratorRoutePath(this, routePath)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // The route path is written verbatim as the folder structure — never kebab-cased/reshaped —
  // since it directly determines the URL this page resolves to (including dynamic segments like
  // `[id]`, which a case transform must never touch). Only the generated class/function names are
  // derived from it, as a starting point.
  const pageFolder = `${projectRoot}/src/space/routes/${routePath}`
  const pascalName = pascalNameFromRoutePath(routePath)

  const { files } = planPage(pascalName, pageFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: pageFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Page file created successfully in 'routes/${routePath}/page.tsx'.`,
  )
}

export default generatePageAction

export function registerPageCommand(cwd: Commander): void {
  cwd.command('page')
    .description(
      "Generate a file-based page (routes/<route-path>/page.tsx) — e.g. 'products/[id]'.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<route-path:string> [root:string]')
    .action((options, ...args) => {
      return generatePageAction.call(cwd, options, ...args)
    })
}
