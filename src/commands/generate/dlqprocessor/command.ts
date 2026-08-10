import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { toKebabCase } from 'utils/casing.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { dlqModelTemplate, dlqProcessorTemplate } from 'commands/generate/dlqprocessor/template.ts'

export interface DlqProcessorPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface DlqProcessorPlan {
  files: DlqProcessorPlanFile[]
}

/**
 * Pure planning for a DLQ processor: given a name + `--process-type` + `--schedule` + the target
 * `dlq/`/`repositories/` folders, returns both files a DLQ processor needs together — the
 * per-processor `dlq/<name>.defs.ts` AND the one-time, fixed-path `repositories/dlq.defs.ts` model
 * registration (bundled into the same plan, not a separate step a caller could forget — same
 * reasoning as `planRto`'s own `ensureConstants`). Unlike `rto`/`seeder`'s side effects (those
 * append into a file that may already have other content), `repositories/dlq.defs.ts` is a whole
 * standalone file with fixed content — `createFilesAndFolders`'s existing "never overwrite an
 * existing file" write semantics is what actually keeps it written exactly once across multiple
 * `zanix generate dlqprocessor` runs, no bespoke ensure-function needed.
 *
 * Throws a plain `Error` when `processType`/`schedule` are missing — both are required for
 * `registerDLQProcessor` to mean anything (there's no "on-demand" DLQ processor, unlike `job`).
 */
export function planDlqProcessor(
  kebabName: string,
  processType: string | undefined,
  schedule: string | undefined,
  dlqFolder: string,
  repositoriesFolder: string,
): DlqProcessorPlan {
  if (!processType) {
    throw new Error("The 'dlqprocessor' generator needs a --process-type <type>.")
  }
  if (!schedule) {
    throw new Error("The 'dlqprocessor' generator needs a --schedule <cron expression>.")
  }

  return {
    files: [
      {
        PATH: `${dlqFolder}/${kebabName}.defs.ts`,
        NAME: `${kebabName}.defs.ts`,
        content: () => Promise.resolve(dlqProcessorTemplate(kebabName, processType, schedule)),
      },
      {
        PATH: `${repositoriesFolder}/dlq.defs.ts`,
        NAME: 'dlq.defs.ts',
        content: () => Promise.resolve(dlqModelTemplate()),
      },
    ],
  }
}

async function generateDlqProcessorAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'dlqprocessor', root)

  const { processType, schedule, verify } = options as {
    processType?: string
    schedule?: string
    verify?: boolean
  }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const dlqFolder = `${projectRoot}/src/server/dlq`
  const repositoriesFolder = `${projectRoot}/src/server/repositories`

  let plan: DlqProcessorPlan
  try {
    plan = planDlqProcessor(kebabName, processType, schedule, dlqFolder, repositoriesFolder)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  const tree: ZanixFolderGenericTree = { FOLDER: dlqFolder, templates: { base: plan.files } }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/asyncmq')
  await ensureZanixDependency(root, '@zanix/datamaster')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(`DLQ processor file created successfully in 'dlq/${kebabName}.defs.ts'.`)
}

export default generateDlqProcessorAction

export function registerDlqProcessorCommand(cwd: Commander): void {
  cwd.command('dlqprocessor')
    .description(
      'Generate a DLQ reprocessing job (dlq/<name>.defs.ts) — also ensures the shared DLQ model ' +
        "registration exists at 'repositories/dlq.defs.ts'.",
    )
    .option('-p --process-type <type:string>', 'The DLQ entry processType to claim and reprocess.')
    .option(
      '-s --schedule <expression:string>',
      'A 6-field cron expression for how often to check for claimable entries ' +
        '(e.g. "0,30 * * * * *").',
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateDlqProcessorAction.call(cwd, options, ...args)
    })
}
