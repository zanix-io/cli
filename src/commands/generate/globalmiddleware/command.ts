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
import { globalGuardTemplate } from 'commands/generate/globalmiddleware/guard.template.ts'
import { globalInterceptorTemplate } from 'commands/generate/globalmiddleware/interceptor.template.ts'
import { globalPipeTemplate } from 'commands/generate/globalmiddleware/pipe.template.ts'

type GlobalMiddlewareRenderer = (pascalName: string) => string

/**
 * Every supported `--kind`, mapped to its generated file's suffix (`<name>.<suffix>.ts`) and its
 * render function. `registerGlobalPipe`/`registerGlobalGuard`/`registerGlobalInterceptor` in
 * `@zanix/server` (`modules/infra/middlewares/defs/{pipes,guards,interceptors}.ts`) are the three
 * real primitives behind this generator — structurally distinct from `middleware`'s own
 * `defineMiddlewareDecorator`-based `MIDDLEWARE_TYPES`: those produce a decorator applied by hand to
 * one handler/class; these register a DSL-style, app-wide middleware that's never applied anywhere,
 * only auto-discovered — the same `.defs.ts` shape `job`/`dlqprocessor` already establish for this
 * codebase (a standalone command, not a 4th `--kind` bolted onto `middleware`, precisely because
 * the shape differs this much; see `registerGlobalMiddlewareCommand`'s own doc for the full
 * reasoning).
 *
 * Every suffix ends in `.defs.ts` — the real `@zanix/server` `ZANIX_SERVER_MODULES` suffix
 * `@zanix/core`'s `defineLocalMetadata` auto-scans for (matched via a plain `endsWith`, not
 * exact-match — see `handler/command.ts`'s own `HANDLER_TYPES` doc for the full mechanism this
 * generator deliberately follows from day one, rather than repeating the bug that doc describes).
 * Each kind still has its own distinctive prefix (`pipe`/`guard`/`interceptor`) before `.defs.ts` so
 * generating more than one kind for the same entity name never collides on the same file — e.g.
 * `audit.pipe.defs.ts` vs. `audit.guard.defs.ts` for the same `name`. Confirmed end-to-end via a
 * real subprocess regression test, `discovery-live.test.ts` (sibling test file).
 */
export const GLOBAL_MIDDLEWARE_TYPES: Record<
  string,
  { suffix: string; render: GlobalMiddlewareRenderer }
> = {
  pipe: { suffix: 'pipe.defs', render: globalPipeTemplate },
  guard: { suffix: 'guard.defs', render: globalGuardTemplate },
  interceptor: { suffix: 'interceptor.defs', render: globalInterceptorTemplate },
}

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface GlobalMiddlewarePlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface GlobalMiddlewarePlan {
  files: GlobalMiddlewarePlanFile[]
}

/**
 * Pure planning for a global middleware: given a name + `--kind` + the target
 * `shared/middlewares/` folder, returns the one file it needs. Throws a plain `Error` when `kind`
 * is missing or unsupported — the caller decides how to surface it
 * (`generateGlobalMiddlewareAction` below routes it through `this.throw`). No default, same
 * reasoning `middleware`'s own `planMiddleware` already establishes: `pipe`/`guard`/`interceptor`
 * are three equally common, equally "primary" concerns in `@zanix/server`'s own docs, so defaulting
 * to one over the others would be an unverified guess.
 */
export function planGlobalMiddleware(
  kebabName: string,
  pascalName: string,
  kind: string | undefined,
  middlewaresFolder: string,
): GlobalMiddlewarePlan {
  if (!kind) {
    throw new Error(
      "The 'globalmiddleware' generator needs a --kind <pipe|guard|interceptor>.",
    )
  }

  const middlewareType = GLOBAL_MIDDLEWARE_TYPES[kind]
  if (!middlewareType) {
    throw new Error(
      `Unsupported global middleware kind '${kind}'. Supported kinds: ${
        Object.keys(GLOBAL_MIDDLEWARE_TYPES).join(', ')
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

/** `zanix generate globalmiddleware <name>`'s real orchestration: `--kind` (required — see
 * `planGlobalMiddleware`'s own doc) selects which of the 3 global middleware shapes
 * `planGlobalMiddleware` renders (see `GLOBAL_MIDDLEWARE_TYPES`), writes the file into
 * `src/shared/middlewares/` — the SAME folder `zanix new server`'s own scaffold already seeds with
 * its per-handler `middleware` examples (`commands/new/lib/tree/projects/main.ts`'s
 * `MIDDLEWARES_RECIPE`) and the real, observed project convention for app-level middleware
 * definitions — ensures `@zanix/server` is declared, then optionally `--verify`s. */
async function generateGlobalMiddlewareAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'globalmiddleware', root)
  assertSafeGeneratorName(this, name)

  const { kind, verify } = options as { kind?: string; verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const middlewaresFolder = `${projectRoot}/src/shared/middlewares`

  let plan: GlobalMiddlewarePlan
  try {
    plan = planGlobalMiddleware(kebabName, pascalName, kind, middlewaresFolder)
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
    `Global middleware file created successfully in 'shared/middlewares/${plan.files[0].NAME}'.`,
  )
}

export default generateGlobalMiddlewareAction

/**
 * Registers `zanix generate globalmiddleware` as its own top-level generator, not a 4th `--kind` on
 * `zanix generate middleware`: the existing `middleware` command's 3 kinds (`guard`/`pipe`/
 * `interceptor`) already share ONE concept — a decorator applied by hand to a specific
 * handler/class (`defineMiddlewareDecorator`) — so its `MIDDLEWARE_TYPES` list is homogeneous by
 * design (same file-write shape, same "never auto-discovered" story). A global/app-wide middleware
 * is a different concept entirely: a DSL definition, written once, auto-discovered from
 * `shared/middlewares/*.defs.ts` and applied to every matching request with no handler-level
 * wiring at all — structurally the same shape `job`/`dlqprocessor` already use for their own
 * `.defs.ts` output (their own dedicated commands, not a `--kind` of some other generator). Forcing
 * this into `middleware --kind global-pipe` (or similar) would mix two file-write shapes under one
 * option list, breaking the homogeneity `MIDDLEWARE_TYPES`'s own doc already relies on. The command
 * name itself follows `dlqprocessor`'s own established precedent for a compact, unhyphenated
 * multi-word backend generator name, rather than introducing a first hyphenated backend name
 * (`not-found`/`no-found`-style hyphenation exists only among the frontend generators, where it
 * matches an externally-fixed convention, not a `cli`-internal naming choice).
 */
export function registerGlobalMiddlewareCommand(cwd: Commander): void {
  cwd.command('globalmiddleware')
    .description(
      'Generate an app-wide middleware DSL definition (shared/middlewares/<name>.<kind>.defs.ts), ' +
        'auto-discovered and applied to every matching request — never wired to a specific ' +
        'handler by hand. guard, pipe, or interceptor.',
    )
    .option(
      '-k --kind <kind:string>',
      `The global middleware kind (required): ${Object.keys(GLOBAL_MIDDLEWARE_TYPES).join(', ')}.`,
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateGlobalMiddlewareAction.call(cwd, options, ...args)
    })
}
