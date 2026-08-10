import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { toKebabCase, toPascalCase } from 'utils/casing.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { subscriberTemplate } from 'commands/generate/subscriber/template.ts'

export interface SubscriberPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface SubscriberPlan {
  files: SubscriberPlanFile[]
}

/**
 * Pure planning for a subscriber: given a name + queue route + the target `subscribers/` folder.
 * Not called from `zanix new`'s own scaffold today (no project type generates an example
 * subscriber) — extracted anyway for the same reason `seeder`'s was, even before `zanix new` had a
 * caller for it: consistency with every other generator, and ready the moment a scaffold needs it.
 */
export function planSubscriber(
  kebabName: string,
  pascalName: string,
  queue: string | undefined,
  subscribersFolder: string,
): SubscriberPlan {
  return {
    files: [{
      PATH: `${subscribersFolder}/${kebabName}.subscriber.ts`,
      NAME: `${kebabName}.subscriber.ts`,
      content: () => Promise.resolve(subscriberTemplate(pascalName, queue ?? kebabName)),
    }],
  }
}

async function generateSubscriberAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'subscriber', root)

  const { queue, verify } = options as { queue?: string; verify?: boolean }

  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  const subscribersFolder = `${projectRoot}/src/server/subscribers`

  const { files } = planSubscriber(kebabName, pascalName, queue, subscribersFolder)
  const tree: ZanixFolderGenericTree = { FOLDER: subscribersFolder, templates: { base: files } }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/asyncmq')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Subscriber file created successfully in 'subscribers/${kebabName}.subscriber.ts'.`,
  )
}

export default generateSubscriberAction

export function registerSubscriberCommand(cwd: Commander): void {
  cwd.command('subscriber')
    .description('Generate a queue subscriber shell (<name>.subscriber.ts).')
    .option(
      '-q --queue <route:string>',
      'The queue/topic route to subscribe to. Defaults to the kebab-cased name.',
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateSubscriberAction.call(cwd, options, ...args)
    })
}
