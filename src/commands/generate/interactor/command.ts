import type { ZanixFolderGenericTree } from 'typings/tree.ts'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType, getCurrentProjectType } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorName } from 'commands/generate/shared/safe-name.ts'
import { assertValidIdentifier } from 'commands/generate/shared/valid-identifier.ts'
import { toKebabCase, toPascalCase } from '@zanix/helpers'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { interactorTemplate } from 'commands/generate/interactor/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface InteractorPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface InteractorPlan {
  files: InteractorPlanFile[]
}

/**
 * Pure planning for an interactor: given a name + the target folder, returns the one file it
 * needs. The target folder itself is resolved by the caller — `resolveInteractorsFolder` below for
 * `zanix generate interactor`'s own action, or `zanix new server`'s own Recipe leaf
 * (`commands/new/lib/tree/projects/server.ts`) — this function has no project-type knowledge of
 * its own, same separation `middleware`'s `planMiddleware` keeps from its own folder resolution.
 */
export function planInteractor(
  kebabName: string,
  pascalName: string,
  interactorsFolder: string,
): InteractorPlan {
  return {
    files: [{
      PATH: `${interactorsFolder}/${kebabName}.interactor.ts`,
      NAME: `${kebabName}.interactor.ts`,
      content: () => Promise.resolve(interactorTemplate(pascalName)),
    }],
  }
}

/**
 * Resolves the target folder a `<name>.interactor.ts` lands in, given the current project's real
 * `zanix.project` type. `server`/`space-server` keep the original, single shared
 * `src/server/interactors/` folder — every interactor in a backend project sits together there,
 * matching every other backend artifact's own `src/server/<plural>/` shape.
 *
 * A plain `space` project has no `src/server/` at all, so it can't reuse that shape — it follows
 * the real, already-proven `@zanix/console` convention instead, used by any `space` app that
 * consumes a remote, typed Zanix API rather than owning its own backend: one folder per domain,
 * named after the interactor's own kebab-case name
 * (`src/triggers/triggers.interactor.ts`, `src/templates/templates.interactor.ts`) — the default
 * for the common case, since 3 of `@zanix/console`'s own 4 real interactors follow it exactly
 * (`login.interactor.ts` is the one documented exception, living inside the broader `auth/` domain
 * folder alongside the rest of that domain's auth composition rather than its own `login/` folder —
 * a per-consumer judgment call this generator's default doesn't need to special-case).
 */
export function resolveInteractorsFolder(
  projectRoot: string,
  projectType: string | undefined,
  kebabName: string,
): string {
  return projectType === 'space'
    ? `${projectRoot}/src/${kebabName}`
    : `${projectRoot}/src/server/interactors`
}

/**
 * `zanix generate interactor <name>` — an interactor/service shell (`<name>.interactor.ts`), the
 * bridge between a handler (HTTP/socket/GraphQL) and the data layer.
 *
 * Runs in `server`/`space-server` (unchanged: `src/server/interactors/<name>.interactor.ts`) and
 * also in a plain `space` project (`src/<name>/<name>.interactor.ts`) — a real, working `space`
 * app that consumes a remote, typed Zanix API rather than owning its own backend needs
 * `ZanixInteractor`s to front its own thin `RestClient` wrappers, the same shape
 * `@zanix/console`'s own hand-authored
 * `TriggersInteractor`/`TemplatesInteractor` already use. See `resolveInteractorsFolder` above for
 * exactly which folder each project type gets.
 */
async function generateInteractorAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['server', 'space-server', 'space'], 'interactor', root)
  assertSafeGeneratorName(this, name)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const projectType = getCurrentProjectType(root)
  const interactorsFolder = resolveInteractorsFolder(projectRoot, projectType, kebabName)

  const { files } = planInteractor(kebabName, pascalName, interactorsFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: interactorsFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/server')

  if (verify) await verifyGeneratedProject(projectRoot)

  const relativePath = projectType === 'space'
    ? `${kebabName}/${kebabName}.interactor.ts`
    : `interactors/${kebabName}.interactor.ts`
  logger.info(`Interactor file created successfully in '${relativePath}'.`)
}

export default generateInteractorAction

export function registerInteractorCommand(cwd: Commander): void {
  cwd.command('interactor')
    .description(
      'Generate an interactor/service shell (<name>.interactor.ts). ' +
        "In 'server'/'space-server' projects it lands in the shared 'interactors/' folder; in a " +
        "plain 'space' project it lands in its own '<name>/' domain folder.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateInteractorAction.call(cwd, options, ...args)
    })
}
