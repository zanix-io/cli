import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'
import type { FieldDef } from 'commands/generate/rto/parser.ts'

import { createFilesAndFolders, ensureConstant } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { parseFields } from 'commands/generate/rto/parser.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import {
  isObjectIdTemplate,
  isPermissionTemplate,
  OBJECTID_REGEX_CONSTANT,
  PERMISSION_REGEX_CONSTANT,
  rtoTemplate,
} from 'commands/generate/rto/renderer.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface RtoPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface RtoPlan {
  files: RtoPlanFile[]
  /**
   * Ensures `OBJECTID_REGEX`/`PERMISSION_REGEX` exist in `projectRoot`'s `src/utils/constants.ts`
   * — every RTO's `IsObjectID`/`IsPermission.ts` (in `files` above) imports one or both of these,
   * so a caller that writes `files` without also calling this leaves an import to a constant that
   * doesn't exist. Kept as part of the same plan (not a separate step a caller could forget) for
   * exactly that reason.
   */
  ensureConstants: (projectRoot: string) => Promise<void>
}

/**
 * Pure planning for an RTO: given a name + parsed fields + the target `rtos/` folder, returns
 * every file it needs (the RTO itself, `IsObjectID.ts` always, `IsPermission.ts` only if a
 * `permission` field is used) plus the `constants.ts` side effect those files depend on. No
 * `Commander`/`assertProjectType`/logging — safe to call from anywhere that needs "the real
 * output of generating an RTO," including `zanix new`'s own scaffold (`projects/server.ts`), not
 * just `zanix generate rto`'s own action below.
 */
export function planRto(
  kebabName: string,
  pascalName: string,
  fields: FieldDef[],
  rtosFolder: string,
): RtoPlan {
  const validationsFolder = `${rtosFolder}/validations`
  const usesPermission = fields.some((field) => field.type === 'permission')

  const files: RtoPlanFile[] = [
    {
      PATH: `${rtosFolder}/${kebabName}.rto.ts`,
      NAME: `${kebabName}.rto.ts`,
      content: () => Promise.resolve(rtoTemplate(pascalName, fields)),
    },
    // Every RTO here has a `Get`/`Edit` variant with an `id: objectId` field, so `IsObjectID` is
    // always needed — generated once, alongside, never overwritten on a later `rto` run.
    {
      PATH: `${validationsFolder}/IsObjectID.ts`,
      NAME: 'IsObjectID.ts',
      content: () => Promise.resolve(isObjectIdTemplate()),
    },
  ]

  if (usesPermission) {
    files.push({
      PATH: `${validationsFolder}/IsPermission.ts`,
      NAME: 'IsPermission.ts',
      content: () => Promise.resolve(isPermissionTemplate()),
    })
  }

  const ensureConstants = async (projectRoot: string) => {
    const constantsPath = `${projectRoot}/src/utils/constants.ts`
    await ensureConstant(
      constantsPath,
      'OBJECTID_REGEX',
      OBJECTID_REGEX_CONSTANT,
    )
    if (usesPermission) {
      await ensureConstant(
        constantsPath,
        'PERMISSION_REGEX',
        PERMISSION_REGEX_CONSTANT,
      )
    }
  }

  return { files, ensureConstants }
}

/** `zanix generate rto <name> --field <spec>`'s real orchestration: `--field`'s DSL strings parse
 * into a structured field model (`parser.ts`), `planRto` renders the 4-class RTO set from it plus
 * any validator constants the fields need (`IsObjectID.ts`/`IsPermission.ts`, written once), then
 * ensures `@zanix/validator`/`@zanix/types`/`@zanix/datamaster` are declared, then optionally
 * `--verify`s. */
async function generateRtoAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'rto', root)

  const { field: fieldSpecs = [], verify } = options as {
    field?: string[]
    verify?: boolean
  }

  let fields: FieldDef[]
  try {
    fields = parseFields(fieldSpecs)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  const rtosFolder = `${projectRoot}/src/server/handlers/rtos`

  const { files, ensureConstants } = planRto(
    kebabName,
    pascalName,
    fields,
    rtosFolder,
  )
  const tree: ZanixFolderGenericTree = {
    FOLDER: rtosFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureConstants(projectRoot)
  await ensureZanixDependency(root, '@zanix/validator')
  await ensureZanixDependency(root, '@zanix/types')
  await ensureZanixDependency(root, '@zanix/datamaster')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `RTO file created successfully in 'handlers/rtos/${kebabName}.rto.ts'.`,
  )
}

export default generateRtoAction

export function registerRtoCommand(cwd: Commander): void {
  // Registered directly (not through a shared no-options helper): cliffy's `.option()` builds a
  // per-call, incrementally-narrowed generic type — a shared helper trying to apply options
  // generically (e.g. via a loop) breaks that inference. Mirrors `commands/prepare/main.ts`'s own
  // inline `.option()` use.
  cwd.command('rto')
    .description(
      "Generate an entity's RTO pair — Search/Get/Create/Edit — in handlers/rtos/<name>.rto.ts.",
    )
    .option(
      '-f --field <spec:string>',
      "A field spec: 'name:type', 'name:type?' (optional), 'name:type[]' (array), or " +
        "'name:enum(A,B,C)'. Types: string, number, boolean, email, date, uuid, objectId, " +
        'permission, enum(...). Repeatable — pass one --field per field.',
      { collect: true },
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateRtoAction.call(cwd, options, ...args)
    })
}
