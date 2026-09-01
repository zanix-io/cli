import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureServerScaffoldSideEffects } from 'commands/new/lib/tree/projects/server.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import { ensureSpaceUiDependency } from 'commands/new/lib/tree/projects/space-icons.ts'
import { assertKnownPages, parsePagesFlag } from 'commands/new/lib/tree/projects/space-pages.ts'
import { getProjectMessageLangs } from 'commands/generate/shared/project.ts'
import { assertKnownTheme, type ThemeName } from 'commands/new/lib/tree/themes.ts'
import { assertValidRenderer, type RendererName } from 'commands/new/lib/renderer.ts'
import { formatGeneratedProject, verifyGeneratedProject } from 'utils/verify.ts'
import { assertSafeProjectName } from 'utils/projects/validate-name.ts'
import logger from '@zanix/utils/logger'

/**
 * `zanix new spacecraft`'s real orchestration — a `space` frontend + a `server`, in one project.
 * Rejects a `..` path-traversal segment in `projectName` (`assertSafeProjectName`) and validates
 * `--renderer` (`assertValidRenderer` — either failure routes through `this.throw`, same
 * as an unknown `--template`, all before anything is written), resolves the
 * combined tree, writes it, then runs BOTH side-effect passes in a fixed order —
 * `ensureServerScaffoldSideEffects` first, then `ensureSpaceScaffoldSideEffects` — saves
 * `deno.json`'s Zanix config, then — both independently opt-in, off by default — `--verify`s the
 * generated project and/or `--prepare`s it (`zanix prepare <name> --project-type=space-server -g
 * -e`, unless `--no-prepare` was passed).
 *
 * `template` (`options.template`) is a plain `string`, not `ZanixTemplates` — same reasoning as
 * `newSpaceAction`'s own doc: `--template`'s real validation is runtime
 * (`assertKnownPreset`/`resolveRecipe`), and `ZanixTemplates` only describes
 * `ZanixTemplatesRecord`'s single `'base'` key, a different concept from which preset built this
 * tree. `createFilesAndFolders(structure, 'base')` below passes that literal key directly, never
 * `template` — see `newSpaceAction`'s own doc for the full reasoning (passing `template` there
 * instead would silently write nothing at all, for any preset other than `'base'`).
 *
 * `--icons` (`options.icons`) — same reasoning/forwarding as `newSpaceAction`'s own doc: forwarded
 * only to `ensureSpaceScaffoldSideEffects` (`renderer` included, for the same
 * `src/space/catalog-icon.ts` wrapper reason), never to `getZanixPaths` (`space.app.ts`'s
 * `assetsDir` is unconditional now, independent of `--icons` — see `getSpaceAppTemplate`'s own
 * doc); the server half of a spacecraft project has no icon-catalog concept of its own, so this
 * only ever affects `ensureSpaceScaffoldSideEffects`'s own pass, never
 * `ensureServerScaffoldSideEffects`. `ensureSpaceUiDependency` runs AFTER `saveZanixConfig`, gated
 * on `ensureSpaceScaffoldSideEffects`'s own return value OR
 * `template === 'welcome'`/`'population'`/`'population-lang'`, OR `theme === 'astronaut'`, OR
 * `pages.includes('error')` — same ordering/reasoning as `newSpaceAction`'s own doc.
 *
 * `--pages` — same parsing/validation/forwarding as `newSpaceAction`'s own doc.
 */
async function newSpacecraftAction(
  this: Commander,
  options: {
    template: string
    renderer?: string
    icons?: boolean
    theme?: string
    pages?: string
    prepare?: boolean
    verify?: boolean
  },
  projectName = 'my-zanix-spacecraft',
) {
  const projectType = 'space-server'
  const { template, prepare, verify, icons, theme } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  let renderer: RendererName
  let pages: ReturnType<typeof parsePagesFlag>
  try {
    assertSafeProjectName(projectName)
    renderer = assertValidRenderer(options.renderer)
    if (theme !== undefined) assertKnownTheme(theme)
    pages = parsePagesFlag(options.pages)
    assertKnownPages(pages)
    structure = getZanixPaths(
      projectType,
      projectName,
      template,
      renderer,
      theme as ThemeName,
    )
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, 'base')
  await ensureServerScaffoldSideEffects(structure.FOLDER, template)
  const iconsReady = await ensureSpaceScaffoldSideEffects(
    structure.FOLDER,
    template,
    icons,
    renderer,
    theme as ThemeName,
    pages,
  )

  await saveZanixConfig(projectType, projectName, renderer)
  if (
    iconsReady || template === 'welcome' || template === 'population' ||
    template === 'population-lang' || theme === 'astronaut' || pages.includes('error') ||
    (pages.includes('not-found') && getProjectMessageLangs(structure.FOLDER) !== undefined)
  ) {
    await ensureSpaceUiDependency(structure.FOLDER)
  }

  await formatGeneratedProject(structure.FOLDER)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [
      projectName,
      `--project-type=${projectType}`,
      '-g',
      '-e',
    ])
  }

  logger.info(
    `Spacecraft created sucessfully in the '${projectName}' folder using the '${template}' ` +
      `template (renderer: '${renderer}').`,
  )
}

export default newSpacecraftAction
