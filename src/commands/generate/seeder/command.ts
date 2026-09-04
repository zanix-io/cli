import type { ZanixFolderGenericTree } from 'typings/tree.ts'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { fileExists, toKebabCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import {
  SEEDER_DEV,
  SEEDER_MAIN,
  SEEDER_PROD,
  SEEDERS_HELPER,
} from 'commands/generate/seeder/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface SeederPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface SeederPlan {
  files: SeederPlanFile[]
  /**
   * Ensures `src/utils/seeders.ts` exists — `main.ts` (in `files` above) imports `defineSeeders`
   * from it, so a caller that writes `files` without also calling this leaves an import to a file
   * that doesn't exist. Kept as part of the same plan for the same reason `rto`'s `planRto`
   * bundles its own `ensureConstants`: a caller can't forget a step it never has to call
   * separately. Never overwrites an existing helper (a project can have several seeders, all
   * sharing the one helper written by whichever ran first).
   */
  ensureHelper: (projectRoot: string) => Promise<void>
}

/**
 * Pure planning for a seeder trio: given the target `seeders/` folder, returns `main.ts`/
 * `seeders.dev.ts`/`seeders.prod.ts` plus the shared `src/utils/seeders.ts` helper side effect
 * those files depend on. No `Commander`/`assertProjectType`/logging — safe to call from `zanix
 * new`'s own scaffold (`projects/server.ts`) as well as `zanix generate seeder`'s action below.
 */
export function planSeeder(seedersFolder: string): SeederPlan {
  const files: SeederPlanFile[] = [
    {
      PATH: `${seedersFolder}/main.ts`,
      NAME: 'main.ts',
      content: () => Promise.resolve(SEEDER_MAIN),
    },
    {
      PATH: `${seedersFolder}/seeders.dev.ts`,
      NAME: 'seeders.dev.ts',
      content: () => Promise.resolve(SEEDER_DEV),
    },
    {
      PATH: `${seedersFolder}/seeders.prod.ts`,
      NAME: 'seeders.prod.ts',
      content: () => Promise.resolve(SEEDER_PROD),
    },
  ]

  const ensureHelper = async (projectRoot: string) => {
    const helperPath = `${projectRoot}/src/utils/seeders.ts`
    if (!fileExists(helperPath)) {
      await Deno.mkdir(`${projectRoot}/src/utils`, { recursive: true })
      await Deno.writeTextFile(helperPath, SEEDERS_HELPER)
    }
  }

  return { files, ensureHelper }
}

async function generateSeederAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'seeder', root)
  assertSafeGeneratorName(this, name)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const folderName = toKebabCase(name)
  const seedersFolder = `${projectRoot}/src/server/repositories/${folderName}/seeders`

  const { files, ensureHelper } = planSeeder(seedersFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: seedersFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureHelper(projectRoot)

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Seeder files created successfully in 'repositories/${folderName}/seeders'.`,
  )
}

export default generateSeederAction

export function registerSeederCommand(cwd: Commander): void {
  cwd.command('seeder')
    .description(
      "Generate a repository's seeder files (main.ts, seeders.dev.ts, seeders.prod.ts).",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateSeederAction.call(cwd, options, ...args)
    })
}
