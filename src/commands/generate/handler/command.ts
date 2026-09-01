import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { assertValidIdentifier } from 'commands/generate/shared/valid-identifier.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { handlerTemplate } from 'commands/generate/handler/rest.template.ts'
import { graphqlHandlerTemplate } from 'commands/generate/handler/graphql.template.ts'
import { socketHandlerTemplate } from 'commands/generate/handler/socket.template.ts'
import { ssrHandlerTemplate } from 'commands/generate/handler/ssr.template.ts'

type HandlerRenderer = (pascalName: string, kebabName: string) => string

/**
 * Every supported `--type`, mapped to its generated file's suffix (`<name>.<suffix>.ts`) and its
 * render function. Every suffix ends in `.handler.ts` — `@zanix/server`'s own real
 * `ZANIX_SERVER_MODULES` (`utils/constants.ts`), which `@zanix/core`'s `defineLocalMetadata` uses
 * to auto-discover project files via `@zanix/helpers`'s `collectFiles` (a plain `endsWith` check,
 * not exact-match), only recognizes 5 suffixes — `.handler.ts`/`.interactor.ts`/`.connector.ts`/
 * `.provider.ts`/`.defs.ts` — and `@zanix/server`'s own README architecture diagram lists
 * Controllers/Resolvers/Sockets alike as `*.handler.ts` ("HANDLERS"). A `graphql`/`socket`/`ssr`
 * file that instead ended in a suffix like `.resolver.ts`/`.socket.ts`/`.ssr.ts` (none of which
 * `endsWith` any of those 5) would never be imported by `Zanix.start()`/`Zanix.compose()` at all —
 * confirmed via a real subprocess regression test, `discovery-live.test.ts` (sibling file). Each
 * non-`rest` suffix still has its own distinctive prefix (`resolver`/`socket`/`ssr`) before
 * `.handler.ts` so generating more than one type for the same entity name never collides on the
 * same file — e.g. `products.handler.ts` (rest) vs. `products.resolver.handler.ts` (graphql) for
 * the same `name`. Exported so Drift Watch (`scripts/drift-watch.ts`) can derive its own `--type`
 * variant matrix from this real source instead of a separately hand-maintained list that could
 * silently drift from it.
 */
export const HANDLER_TYPES: Record<
  string,
  { suffix: string; render: HandlerRenderer }
> = {
  rest: { suffix: 'handler', render: handlerTemplate },
  graphql: { suffix: 'resolver.handler', render: graphqlHandlerTemplate },
  socket: { suffix: 'socket.handler', render: socketHandlerTemplate },
  ssr: { suffix: 'ssr.handler', render: ssrHandlerTemplate },
}

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface HandlerPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface HandlerPlan {
  files: HandlerPlanFile[]
}

/**
 * Pure planning for a handler: given a name + `--type` + the target `handlers/` folder, returns
 * the one file it needs. Throws a plain `Error` for an unsupported `type` (the caller decides how
 * to surface it — `generateHandlerAction` below routes it through `this.throw`; `zanix new`'s own
 * scaffold never passes an invalid type, so it never needs to catch anything here).
 */
export function planHandler(
  kebabName: string,
  pascalName: string,
  type: string,
  handlersFolder: string,
): HandlerPlan {
  const handlerType = HANDLER_TYPES[type]

  if (!handlerType) {
    throw new Error(
      `Unsupported handler type '${type}'. Supported types: ${
        Object.keys(HANDLER_TYPES).join(', ')
      }.`,
    )
  }

  const { suffix, render } = handlerType
  const fileName = `${kebabName}.${suffix}.ts`

  return {
    files: [{
      PATH: `${handlersFolder}/${fileName}`,
      NAME: fileName,
      content: () => Promise.resolve(render(pascalName, kebabName)),
    }],
  }
}

/** `zanix generate handler <name>`'s real orchestration: `--type` (default `rest`) selects which
 * of the 4 handler shapes `planHandler` renders (see `HANDLER_TYPES`), writes the file, ensures
 * `@zanix/server` is declared (plus `@zanix/server/graphql` too, for `--type graphql` — the
 * resolver's `ZanixResolver`/`Resolver`/`Query` imports live at that subpath, not the root), then
 * optionally `--verify`s. */
async function generateHandlerAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server'], 'handler', root)
  assertSafeGeneratorName(this, name)

  const { type = 'rest', verify } = options as {
    type?: string
    verify?: boolean
  }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const handlersFolder = `${projectRoot}/src/server/handlers`

  let plan: HandlerPlan
  try {
    plan = planHandler(kebabName, pascalName, type, handlersFolder)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  const tree: ZanixFolderGenericTree = {
    FOLDER: handlersFolder,
    templates: { base: plan.files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/server')
  if (type === 'graphql') await ensureZanixDependency(root, '@zanix/server/graphql')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Handler file created successfully in 'handlers/${plan.files[0].NAME}'.`,
  )
}

export default generateHandlerAction

export function registerHandlerCommand(cwd: Commander): void {
  cwd.command('handler')
    .description(
      'Generate a request handler (<name>.<suffix>.handler.ts) — rest (default), graphql, socket, ' +
        'or ssr.',
    )
    .option(
      '-t --type <type:string>',
      `The handler type: ${Object.keys(HANDLER_TYPES).join(', ')}. Defaults to 'rest'.`,
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateHandlerAction.call(cwd, options, ...args)
    })
}
