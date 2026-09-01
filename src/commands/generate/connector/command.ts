import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType, isZanixDependencyDeclared } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { assertValidIdentifier } from 'commands/generate/shared/valid-identifier.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { connectorTemplate } from 'commands/generate/connector/generic.template.ts'
import { databaseConnectorTemplate } from 'commands/generate/connector/database.template.ts'
import { cacheConnectorTemplate } from 'commands/generate/connector/cache.template.ts'
import { restConnectorTemplate } from 'commands/generate/connector/rest.template.ts'
import { graphqlConnectorTemplate } from 'commands/generate/connector/graphql.template.ts'

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
 * Of the slots this generator can produce a shell for, the ones NOT auto-registered by
 * `@zanix/server` itself — unlike `cache:custom`/`cache:memcached`, both registered unconditionally
 * from `connectors/core/mod.ts` the moment `@zanix/server`'s connector decorator module loads,
 * `'database'`/`'cache:redis'`/`'cache:local'` stay reserved-but-unregistered
 * (`connectorCoreModules[slot].registered === false`) until some OTHER package's own module
 * registers them via `registerCoreConnectorSlot` (`connectors/core/all.ts`). Decorating a class
 * with `@Connector({ slot })` for one of these before that registration has run throws a real
 * runtime `InternalError` (`connectors/decorators/assembly.ts`) — see `--slot`'s own option
 * description and `generateConnectorAction`'s precondition warning below.
 *
 * Today, `@zanix/datamaster` is the only real package in the ecosystem that registers any of
 * these three — its Mongo connector registers `'database'`, its Redis/QLRU cache providers
 * register `'cache:redis'`/`'cache:local'` respectively (verified against its own
 * `modules/database/providers/mongo/connector/mod.ts` and `modules/cache/providers/{redis,qlru}/
 * core.ts`).
 */
const SLOTS_REQUIRING_DATAMASTER = new Set(['database', 'cache:redis', 'cache:local'])

/**
 * Known core-connector slots this generator can produce a shell for, per `@zanix/server`'s own
 * `ConnectorCoreModules` registry (`modules/infra/connectors/core/all.ts`). `asyncmq`/`kvLocal`/
 * `search` are deliberately not covered — `asyncmq` already has a real, ready-to-use connector in
 * `@zanix/asyncmq`, and `kvLocal`/`search` weren't verified with the same rigor as `database`/
 * `cache:*` this pass.
 *
 * `'rest'`/`'graphql'` are NOT part of this set (see below) — they're not core slots at all, just
 * two more `--slot` values this same option selects a template by.
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
  else if (slot === 'rest') content = restConnectorTemplate(pascalName)
  else if (slot === 'graphql') content = graphqlConnectorTemplate(pascalName)
  else if (slot.startsWith('cache:')) {
    content = cacheConnectorTemplate(pascalName, slot)
  } else {
    throw new Error(
      `Unsupported connector slot '${slot}'. Supported slots: 'database', 'rest', 'graphql', or ` +
        `any 'cache:<subtype>' (e.g. 'cache:redis'). For 'asyncmq', use @zanix/asyncmq's own ` +
        `connector instead.`,
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
  assertSafeGeneratorName(this, name)

  const { slot, verify } = options as { slot?: string; verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const connectorsFolder = `${projectRoot}/src/server/connectors`

  let plan: ConnectorPlan
  try {
    plan = planConnector(kebabName, pascalName, slot, connectorsFolder)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  if (
    slot && SLOTS_REQUIRING_DATAMASTER.has(slot) &&
    !isZanixDependencyDeclared(root, '@zanix/datamaster')
  ) {
    logger.warn(
      `This project has no '@zanix/datamaster' dependency declared yet, and it's the only ` +
        `package in the ecosystem today that registers the '${slot}' core connector slot (via ` +
        `'registerCoreConnectorSlot', see @zanix/server's 'connectors/core/all.ts'). Decorating ` +
        `'${pascalName}Connector' with @Connector({ slot: '${slot}' }) will throw a real runtime ` +
        `InternalError until a package that registers this slot is added as a dependency AND ` +
        `actually imported (a real module-level side effect, not just declared) before this ` +
        `class is decorated. This generator does not verify that for you.`,
    )
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
    .description(
      'Generate a connector shell (<name>.connector.ts). Server/space-server projects only.',
    )
    .option(
      '-s --slot <slot:string>',
      "Pick a connector shape instead of a generic one: 'database' or any 'cache:<subtype>' " +
        "(e.g. 'cache:redis') register under a core connector slot; 'rest'/'graphql' extend " +
        "@zanix/server's own RestClient/GraphQLClient instead (a plain external-API client, not a " +
        'core slot — no extra dependency required). Omit for a plain external-service connector. ' +
        "WARNING: for 'database'/'cache:redis'/'cache:local', the target project must already " +
        'depend on (and actually import) a package that registers that core slot at runtime ' +
        '(today, only @zanix/datamaster does) — otherwise decorating the generated class throws ' +
        "a real InternalError. This generator warns if @zanix/datamaster isn't declared yet, but " +
        'does not verify the import actually happened.',
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
