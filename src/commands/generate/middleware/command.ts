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
import { guardMiddlewareTemplate } from 'commands/generate/middleware/guard.template.ts'
import { pipeMiddlewareTemplate } from 'commands/generate/middleware/pipe.template.ts'
import { interceptorMiddlewareTemplate } from 'commands/generate/middleware/interceptor.template.ts'

type MiddlewareRenderer = (pascalName: string) => string

/**
 * Every supported `--kind`, mapped to its generated file's suffix (`<name>.<suffix>.ts`) and its
 * render function. `defineMiddlewareDecorator<T extends MiddlewareTypes>(type, middleware)` in
 * `@zanix/server` (`modules/infra/middlewares/decorators/assembly.ts`) is the one real primitive
 * behind all three kinds — `guard`/`pipe`/`interceptor` differ only in the `type` discriminant
 * passed to it and the shape of the middleware function itself (`GuardContext` +
 * `GuardResponse` vs. plain `HandlerContext` +`void` vs. `HandlerContext` + `Response`, per
 * `typings/middlewares.ts`'s own `MiddlewareGuard`/`MiddlewarePipe`/`MiddlewareInterceptor` types)
 * — the exact same relationship `MiddlewareTypes = 'guard' | 'pipe' | 'interceptor'` and the real
 * `Guard`/`Pipe`/`Interceptor` sugar decorators (each a one-line `defineMiddlewareDecorator(kind,
 * fn)` wrapper) encode in `@zanix/server` itself. Distinct suffixes per kind (not all
 * `.middleware.ts`) so generating more than one kind for the same entity name never collides on the
 * same file — same reasoning as `HANDLER_TYPES` (`handler/command.ts`). Exported so Drift Watch
 * (`scripts/drift-watch.ts`) can derive its own `--kind` variant matrix from this real source
 * instead of a separately hand-maintained list that could silently drift from it.
 */
export const MIDDLEWARE_TYPES: Record<
  string,
  { suffix: string; render: MiddlewareRenderer }
> = {
  guard: { suffix: 'guard', render: guardMiddlewareTemplate },
  pipe: { suffix: 'pipe', render: pipeMiddlewareTemplate },
  interceptor: { suffix: 'interceptor', render: interceptorMiddlewareTemplate },
}

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface MiddlewarePlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface MiddlewarePlan {
  files: MiddlewarePlanFile[]
}

/**
 * Pure planning for a middleware: given a name + `--kind` + the target `middlewares/` folder,
 * returns the one file it needs. Throws a plain `Error` when `kind` is missing or unsupported — the
 * caller decides how to surface it (`generateMiddlewareAction` below routes it through
 * `this.throw`). Unlike `handler`'s `--type` (which defaults to `'rest'`), `--kind` has no default:
 * `guard`/`pipe`/`interceptor` are three equally common, equally "primary" concerns in
 * `@zanix/server`'s own docs (`assembly.ts`'s own JSDoc lists them as peers, in no priority order),
 * so defaulting to one over the others would be an unverified guess rather than something grounded
 * in the real API — same reasoning `dlqprocessor`'s required `--process-type`/`--schedule` already
 * establishes for this codebase.
 */
export function planMiddleware(
  kebabName: string,
  pascalName: string,
  kind: string | undefined,
  middlewaresFolder: string,
): MiddlewarePlan {
  if (!kind) {
    throw new Error(
      "The 'middleware' generator needs a --kind <guard|pipe|interceptor>.",
    )
  }

  const middlewareType = MIDDLEWARE_TYPES[kind]
  if (!middlewareType) {
    throw new Error(
      `Unsupported middleware kind '${kind}'. Supported kinds: ${
        Object.keys(MIDDLEWARE_TYPES).join(', ')
      }.`,
    )
  }

  const { suffix, render } = middlewareType
  const fileName = `${kebabName}.${suffix}.ts`

  return {
    files: [{
      PATH: `${middlewaresFolder}/${fileName}`,
      NAME: fileName,
      content: () => Promise.resolve(render(pascalName)),
    }],
  }
}

/** `zanix generate middleware <name>`'s real orchestration: `--kind` (required — see
 * `planMiddleware`'s own doc) selects which of the 3 middleware shapes `planMiddleware` renders (see
 * `MIDDLEWARE_TYPES`), writes the file, ensures `@zanix/server` is declared, then optionally
 * `--verify`s. */
async function generateMiddlewareAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'middleware', root)
  assertSafeGeneratorName(this, name)

  const { kind, verify } = options as { kind?: string; verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  // `src/shared/`, not `src/server/` — this is server-side cross-cutting scaffolding (reusable
  // across handlers), the same convention `zanix new server`'s own scaffold recipe already
  // establishes for this exact artifact (`MIDDLEWARES_RECIPE`, `commands/new/lib/tree/projects/
  // main.ts`) and `globalmiddleware` independently targets for its own DSL definitions
  // (`globalmiddleware/command.ts`). `src/shared/` doesn't exist at all in a pure `space` project
  // (confirmed against the real tree-shape assertions) — it's a server-side-only convention, not a
  // space/server-shared one, despite the name.
  const middlewaresFolder = `${projectRoot}/src/shared/middlewares`

  let plan: MiddlewarePlan
  try {
    plan = planMiddleware(kebabName, pascalName, kind, middlewaresFolder)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  const tree: ZanixFolderGenericTree = {
    FOLDER: middlewaresFolder,
    templates: { base: plan.files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/server')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Middleware file created successfully in 'middlewares/${plan.files[0].NAME}'.`,
  )
}

export default generateMiddlewareAction

export function registerMiddlewareCommand(cwd: Commander): void {
  cwd.command('middleware')
    .description(
      'Generate a middleware shell (<name>.<kind>.ts) built via defineMiddlewareDecorator — ' +
        'guard, pipe, or interceptor.',
    )
    .option(
      '-k --kind <kind:string>',
      `The middleware kind (required): ${Object.keys(MIDDLEWARE_TYPES).join(', ')}.`,
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateMiddlewareAction.call(cwd, options, ...args)
    })
}
