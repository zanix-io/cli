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
import { componentTemplate } from 'commands/generate/component/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface ComponentPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface ComponentPlan {
  files: ComponentPlanFile[]
}

/** Pure planning for a component: given a name + the target `components/` folder. Same shape as
 * `planComet` (`comet/command.ts`) — not called by a `zanix new` scaffold yet; see
 * `generateComponentAction`'s own doc for why. */
export function planComponent(
  kebabName: string,
  pascalName: string,
  componentsFolder: string,
): ComponentPlan {
  return {
    files: [{
      PATH: `${componentsFolder}/${kebabName}.tsx`,
      NAME: `${kebabName}.tsx`,
      content: () => Promise.resolve(componentTemplate(pascalName)),
    }],
  }
}

/**
 * `zanix generate component <name>` — a plain, presentational component, meant to be imported by
 * hand into a `page.tsx`/`layout.tsx`/another component's own `component`/JSX tree (`@zanix/space`'s
 * own README shows exactly this composition: `component = ProductView`). Presentational in the same
 * sense `@zanix/space-ui` documents for its own component library ("presents data, never owns it") —
 * no fetch, no router/history call, no form submission state baked into the generated shell; the
 * caller wires all of that in from outside.
 *
 * Unlike every OTHER frontend artifact this family generates (`comet`/`page`/`layout`/`error`/
 * `loading`/`not-found`), this file is never discovered by its file location or a build-time
 * directive — `@zanix/space` has no `components/` convention of its own to hook into, so nothing
 * about where this file lives is load-bearing to the framework. `components/` is a `cli`-chosen
 * scaffolding default, the same role `comets/` plays for Comet shells, not a framework-enforced path.
 *
 * Not wired into `zanix new space`'s own `SPACE_RECIPE_BASE`
 * (`commands/new/lib/tree/projects/space.ts`) — same reasoning `middleware` documents for `server`
 * (see `docs/generate.md`'s own Middleware section): `ZanixSpaceSrcTree` (`@zanix/utils`'s own
 * published type, aliased here as `@zanix/types`) only declares `routes`/`comets` subfolders today,
 * so there is no typed tree leaf yet for a Recipe entry to target. Adding one requires a
 * `@zanix/utils` release first — out of this repo's own scope. `zanix generate component` still
 * works the same way on any already-scaffolded `space`/`space-server` project.
 */
async function generateComponentAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'component', root)
  assertSafeGeneratorName(this, name)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const componentsFolder = `${projectRoot}/src/space/components`

  const { files } = planComponent(kebabName, pascalName, componentsFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: componentsFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Component file created successfully in 'components/${kebabName}.tsx'.`,
  )
}

export default generateComponentAction

export function registerComponentCommand(cwd: Commander): void {
  cwd.command('component')
    .description(
      'Generate a plain, presentational component (components/<name>.tsx) — imported by hand ' +
        "into a page/layout/another component's own JSX tree.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateComponentAction.call(cwd, options, ...args)
    })
}
