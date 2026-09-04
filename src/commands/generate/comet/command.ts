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
import { cometTemplate } from 'commands/generate/comet/template.ts'

/**
 * One file this generator writes. `content` is a lazily-evaluated, async function rather than a
 * plain string — `createFilesAndFolders` only ever calls it once it has already confirmed `PATH`
 * doesn't exist yet (the never-overwrite guard), so a file this run will end up skipping never
 * pays the cost of computing its content at all. `NAME` and `PATH` must stay in sync (`NAME` is
 * the bare filename, used in log messages; `PATH` is `NAME`'s real location on disk).
 */
export interface CometPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface CometPlan {
  files: CometPlanFile[]
}

/** Pure planning for a comet: given a name + the target `comets/` folder. */
export function planComet(
  kebabName: string,
  pascalName: string,
  cometsFolder: string,
): CometPlan {
  return {
    files: [{
      PATH: `${cometsFolder}/${kebabName}.comet.tsx`,
      NAME: `${kebabName}.comet.tsx`,
      content: () => Promise.resolve(cometTemplate(pascalName)),
    }],
  }
}

async function generateCometAction(
  this: Commander,
  options: unknown,
  name: string,
  root?: string,
) {
  // Comets are a `@zanix/space` concept — never valid for a plain `server` project. Gated to
  // `['space', 'space-server']`, same as this file's own frontend siblings (`page`/`layout`/
  // `error`/`loading`/`not-found`) — unlike every backend generator, gated to
  // `['server', 'space-server']` instead.
  assertProjectType(this, ['space', 'space-server'], 'comet', root)
  assertSafeGeneratorName(this, name)

  const { verify } = options as { verify?: boolean }
  const projectRoot = root ?? Deno.cwd()
  const kebabName = toKebabCase(name)
  const pascalName = toPascalCase(name)
  assertValidIdentifier(this, pascalName, name)
  const cometsFolder = `${projectRoot}/src/space/comets`

  const { files } = planComet(kebabName, pascalName, cometsFolder)
  const tree: ZanixFolderGenericTree = {
    FOLDER: cometsFolder,
    templates: { base: files },
  }

  await createFilesAndFolders(tree, 'base')
  await ensureZanixDependency(root, '@zanix/space')

  if (verify) await verifyGeneratedProject(projectRoot)

  logger.info(
    `Comet file created successfully in 'comets/${kebabName}.comet.tsx'.`,
  )
}

export default generateCometAction

export function registerCometCommand(cwd: Commander): void {
  cwd.command('comet')
    .description(
      'Generate a selective-hydration Comet shell (<name>.comet.tsx).',
    )
    .option(
      '--verify',
      'Opt-in: after generating, run `deno check` against the whole project and warn ' +
        '(without failing) if it does not compile against the currently installed dependencies.',
    )
    .arguments('<name:string> [root:string]')
    .action((options, ...args) => {
      return generateCometAction.call(cwd, options, ...args)
    })
}
