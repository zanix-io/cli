import type { ZanixFolderGenericTree } from 'typings/tree.ts'
import type { Commander } from 'cli'
import type { FieldDef } from 'commands/generate/rto/parser.ts'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { assertValidIdentifier } from 'commands/generate/shared/valid-identifier.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { parseFields } from 'commands/generate/rto/parser.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { rtoTemplate } from 'commands/generate/rto/renderer.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface RtoPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface RtoPlan {
  files: RtoPlanFile[]
  /**
   * A permanent no-op: kept only so `RtoPlan` keeps the same `{ files, ensureConstants }` shape
   * `zanix new server`'s recipe (`projects/server.ts`) and `planSeeder`'s own `ensureHelper`
   * already rely on for the shared `sideEffects: ScaffoldSideEffect[]` mechanism
   * (`new/lib/tree/recipe.ts`) — a caller can keep unconditionally destructuring/calling it
   * without special-casing "this generator has no side effect." No field type generates a local
   * validator file (or the `constants.ts` a hand-rolled one would import from) anymore: `objectId`
   * is a real `@zanix/validator` decorator and `permission` falls back to plain `IsString` — see
   * `rto/renderer.ts`'s own doc for why a dedicated `permission` validator was removed rather than
   * replaced.
   */
  ensureConstants: (projectRoot: string) => Promise<void>
}

/**
 * Pure planning for an RTO: given a name + parsed fields + the target `rtos/` folder, returns the
 * single `<name>.rto.ts` file it needs. No field type generates any other file (`IsObjectID`/
 * `IsPermission` were both real-decorator/plain-`IsString` fallbacks by the time this shipped —
 * see `rto/renderer.ts`'s own doc), so `ensureConstants` is a permanent no-op (see `RtoPlan`'s own
 * doc for why it's kept regardless). No `Commander`/`assertProjectType`/logging — safe to call
 * from anywhere that needs "the real output of generating an RTO," including `zanix new`'s own
 * scaffold (`projects/server.ts`), not just `zanix generate rto`'s own action below.
 */
export function planRto(
  kebabName: string,
  pascalName: string,
  fields: FieldDef[],
  rtosFolder: string,
): RtoPlan {
  const files: RtoPlanFile[] = [
    {
      PATH: `${rtosFolder}/${kebabName}.rto.ts`,
      NAME: `${kebabName}.rto.ts`,
      content: () => Promise.resolve(rtoTemplate(pascalName, fields)),
    },
  ]

  const ensureConstants = (_projectRoot: string): Promise<void> => Promise.resolve()

  return { files, ensureConstants }
}

/** `zanix generate rto <name> --field <spec>`'s real orchestration: `--field`'s DSL strings parse
 * into a structured field model (`parser.ts`), `planRto` renders the 4-class RTO set from it — no
 * field type generates a second local file anymore (`objectId`/`permission` both import straight
 * from `@zanix/validator`, see `rto/renderer.ts`'s own doc) — then ensures `@zanix/validator`/
 * `@zanix/datamaster` are declared, then optionally `--verify`s.
 * No longer ensures `@zanix/types`: it was only needed by `permission`'s old `IsPermission.ts`
 * local validator (the last real consumer), which is gone — matches
 * `PROJECT_TYPE_DEPENDENCIES.server`/`.space-server` (`utils/config/dependencies.ts`), which
 * dropped the same now-dead entry in the same change. */
async function generateRtoAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'rto', root)
  assertSafeGeneratorName(this, name)

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
  assertValidIdentifier(this, pascalName, name)
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
