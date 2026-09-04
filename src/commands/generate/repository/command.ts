import type { ZanixFolderGenericTree } from 'typings/tree.ts'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { assertValidIdentifier } from 'commands/generate/shared/valid-identifier.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { entityProviderTemplate, modelDefsTemplate } from 'commands/generate/repository/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface RepositoryPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface RepositoryPlan {
  files: RepositoryPlanFile[]
}

/**
 * Pure planning for a full repository: given a name + the target per-entity `repositories/<name>/`
 * folder, returns `entity.provider.ts` + `model.defs.ts` together — a repository, as a generated
 * unit, is always both. `zanix new server`'s own scaffold deliberately wants only a standalone
 * `model.defs.ts` (no per-entity subfolder, no provider) for its illustrative example — a lighter
 * shape than a full repository, not an incomplete one, since `model.defs.ts` registers its model
 * via a top-level `registerModel()` side effect and compiles standalone either way (unlike the
 * `rto`/`seeder` cases, nothing else imports it) — so `projects/server.ts` keeps calling
 * `modelDefsTemplate` directly instead of this function.
 */
export function planRepository(
  folderName: string,
  pascalName: string,
  repositoryFolder: string,
): RepositoryPlan {
  return {
    files: [
      {
        PATH: `${repositoryFolder}/entity.provider.ts`,
        NAME: 'entity.provider.ts',
        content: () => Promise.resolve(entityProviderTemplate(pascalName, folderName)),
      },
      {
        PATH: `${repositoryFolder}/model.defs.ts`,
        NAME: 'model.defs.ts',
        content: () => Promise.resolve(modelDefsTemplate(pascalName, folderName)),
      },
    ],
  }
}

async function generateRepositoryAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'repository', root)
  assertSafeGeneratorName(this, name)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const folderName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const repositoryFolder = `${projectRoot}/src/server/repositories/${folderName}`

  const { files } = planRepository(folderName, pascalName, repositoryFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: repositoryFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/server')
  await ensureZanixDependency(root, '@zanix/datamaster')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Repository files created successfully in 'repositories/${folderName}'.`,
  )
}

export default generateRepositoryAction

export function registerRepositoryCommand(cwd: Commander): void {
  cwd.command('repository')
    .description('Generate a repository (entity.provider.ts + model.defs.ts).')
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateRepositoryAction.call(cwd, options, ...args)
    })
}
