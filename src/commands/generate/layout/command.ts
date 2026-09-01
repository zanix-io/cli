import type { ZanixFolderGenericTree } from '@zanix/types'
import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { ensureZanixDependency } from 'utils/config/dependencies.ts'
import { assertProjectType, getProjectRenderer } from 'commands/generate/shared/project.ts'
import { assertSafeGeneratorRoutePath } from 'commands/generate/shared/safe-name.ts'
import { pascalNameFromRoutePath } from 'commands/generate/shared/route-path.ts'
import { verifyGeneratedProject } from 'utils/verify.ts'
import logger from '@zanix/utils/logger'
import { layoutTemplate, rootLayoutTemplate } from 'commands/generate/layout/template.ts'

/** One file this generator writes — same shape/reasoning as `CometPlanFile` (`comet/command.ts`). */
export interface LayoutPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface LayoutPlan {
  files: LayoutPlanFile[]
}

/** Pure planning for a layout: given a pascal name + the target route folder. Split out the same
 * way every sibling generator's `plan<Name>` is (see `page/command.ts`'s `planPage`) — not called
 * by a `zanix new` scaffold yet (no project type seeds a `layout.tsx` example today), but kept
 * consistent with the rest of the family so a future scaffold can reuse it without a refactor. */
export function planLayout(
  pascalName: string,
  layoutFolder: string,
  options: { isRoot?: boolean; renderer?: 'react' | 'preact' } = {},
): LayoutPlan {
  // A ROOT layout owns the document; a nested one does not. `@zanix/space` replaces its own default
  // document shell with whatever the root layout renders and never checks that it rendered a real
  // document, so emitting the nested shape here produced a page with no doctype, no `lang`, no
  // charset and no viewport — a silent regression caused by this generator itself.
  const { isRoot = false, renderer = 'react' } = options
  return {
    files: [{
      PATH: `${layoutFolder}/layout.tsx`,
      NAME: 'layout.tsx',
      content: () =>
        Promise.resolve(
          isRoot ? rootLayoutTemplate(pascalName, renderer) : layoutTemplate(pascalName),
        ),
    }],
  }
}

async function generateLayoutAction(
  this: Commander,
  options: unknown,
  routePath: string,
  root?: string,
) {
  assertProjectType(this, ['space', 'space-server'], 'layout', root)
  assertSafeGeneratorRoutePath(this, routePath)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  // Same reasoning as `page/command.ts`: the route path is written verbatim as the folder
  // structure, never reshaped — it determines which segment this layout wraps.
  const layoutFolder = `${projectRoot}/src/space/routes/${routePath}`
  const pascalName = pascalNameFromRoutePath(routePath)

  // A root layout is the one written directly under `routesDir` — i.e. an empty route path. That
  // is exactly the case `@zanix/space` treats as the app's document owner.
  const isRoot = routePath === '' || routePath === '.' || routePath === '/'
  const { files } = planLayout(pascalName, layoutFolder, {
    isRoot,
    // Derived from `compilerOptions.jsxImportSource`, the compile-time projection of
    // `defineSpaceApp({ renderer })` — one renderer choice, no competing config field. See
    // `getProjectRenderer`'s own doc.
    renderer: getProjectRenderer(projectRoot),
  })
  const tree: ZanixFolderGenericTree = {
    FOLDER: layoutFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Layout file created successfully in 'routes/${routePath}/layout.tsx'.`,
  )
}

export default generateLayoutAction

export function registerLayoutCommand(cwd: Commander): void {
  cwd.command('layout')
    .description(
      "Generate a segment layout (routes/<route-path>/layout.tsx) — e.g. 'products'.",
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<route-path:string> [root:string]')
    .action((options, ...args) => {
      return generateLayoutAction.call(cwd, options, ...args)
    })
}
