import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { connectorTemplate } from 'commands/generate/connector/generic.template.ts'
import { databaseConnectorTemplate } from 'commands/generate/connector/database.template.ts'
import { cacheConnectorTemplate } from 'commands/generate/connector/cache.template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface ConnectorPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface ConnectorPlan {
  files: ConnectorPlanFile[]
}

/**
 * Known core-connector slots this generator can produce a shell for, per `@zanix/server`'s own
 * `ConnectorCoreModules` registry (`modules/infra/connectors/core/all.ts`). `asyncmq`/`kvLocal`/
 * `search` are deliberately not covered — `asyncmq` already has a real, ready-to-use connector in
 * `@zanix/asyncmq`, and `kvLocal`/`search` weren't verified with the same rigor as `database`/
 * `cache:*` this pass.
 *
 * Pure planning: throws a plain `Error` for an unsupported `slot` — the caller decides how to
 * surface it (`generateConnectorAction` below routes it through `this.throw`).
 */
export function planConnector(
  kebabName: string,
  pascalName: string,
  slot: string | undefined,
  connectorsFolder: string,
): ConnectorPlan {
  let content: string
  if (!slot) content = connectorTemplate(pascalName)
  else if (slot === 'database') content = databaseConnectorTemplate(pascalName)
  else if (slot.startsWith('cache:')) {
    content = cacheConnectorTemplate(pascalName, slot)
  } else {
    throw new Error(
      `Unsupported connector slot '${slot}'. Supported slots: 'database', or any 'cache:<subtype>' ` +
        `(e.g. 'cache:redis'). For 'asyncmq', use @zanix/asyncmq's own connector instead.`,
    )
  }

  return {
    files: [{
      PATH: `${connectorsFolder}/${kebabName}.connector.ts`,
      NAME: `${kebabName}.connector.ts`,
      content: () => Promise.resolve(content),
    }],
  }
}

/** `zanix generate connector <name>`'s real orchestration: `planConnector` selects the right
 * template for `--slot` (an unsupported slot routes through `this.throw`, before anything is
 * written), writes the file, ensures `@zanix/server` is declared, then optionally `--verify`s. */
async function generateConnectorAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'connector', root)

  const { slot, verify } = options as { slot?: string; verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  const connectorsFolder = `${projectRoot}/src/server/connectors`

  let plan: ConnectorPlan
  try {
    plan = planConnector(kebabName, pascalName, slot, connectorsFolder)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  const tree: ZanixFolderGenericTree = {
    FOLDER: connectorsFolder,
    templates: { base: plan.files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/server')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Connector file created successfully in 'connectors/${kebabName}.connector.ts'.`,
  )
}

export default generateConnectorAction

export function registerConnectorCommand(cwd: Commander): void {
  cwd.command('connector')
    .description('Generate a connector shell (<name>.connector.ts).')
    .option(
      '-s --slot <slot:string>',
      "Register under a core connector slot instead of a generic one: 'database', or " +
        "'cache:<subtype>' (e.g. 'cache:redis'). Omit for a plain external-service connector.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateConnectorAction.call(cwd, options, ...args)
    })
}
