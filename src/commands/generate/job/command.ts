import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { toKebabCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { jobTemplate } from 'commands/generate/job/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface JobPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface JobPlan {
  files: JobPlanFile[]
}

/** Pure planning for a job: given a name + optional cron expression + the target `jobs/` folder. */
export function planJob(
  kebabName: string,
  cron: string | undefined,
  jobsFolder: string,
): JobPlan {
  return {
    files: [{
      PATH: `${jobsFolder}/${kebabName}.defs.ts`,
      NAME: `${kebabName}.defs.ts`,
      content: () => Promise.resolve(jobTemplate(kebabName, cron)),
    }],
  }
}

async function generateJobAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'job', root)
  assertSafeGeneratorName(this, name)

  const { cron, verify } = options as { cron?: string; verify?: boolean }

  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const jobsFolder = `${projectRoot}/src/server/jobs`

  const { files } = planJob(kebabName, cron, jobsFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: jobsFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/asyncmq/jobs')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(`Job file created successfully in 'jobs/${kebabName}.defs.ts'.`)
}

export default generateJobAction

export function registerJobCommand(cwd: Commander): void {
  // Registered directly (not through a shared no-options helper): cliffy's `.option()` builds a
  // per-call, incrementally-narrowed generic type that a shared helper can't apply generically.
  cwd.command('job')
    .description('Generate a job definitions file (<name>.defs.ts).')
    .option(
      '-c --cron <expression:string>',
      'A 6-field cron expression (e.g. "0 */1 * * * *"). When given, generates a schedule-driven ' +
        'registerCronJob; when omitted, generates an on-demand registerJob instead.',
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateJobAction.call(cwd, options, ...args)
    })
}
