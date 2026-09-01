import type { Commander } from 'cli'

import { createFilesAndFolders } from 'utils/projects/creation.ts'
import { saveZanixConfig } from 'utils/config/main.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'
import { ensureSpaceUiDependency } from 'commands/new/lib/tree/projects/space-icons.ts'
import { assertKnownPages, parsePagesFlag } from 'commands/new/lib/tree/projects/space-pages.ts'
import { getProjectMessageLangs } from 'commands/generate/shared/project.ts'
import { assertKnownTheme, type ThemeName } from 'commands/new/lib/tree/themes.ts'
import { assertValidRenderer, type RendererName } from 'commands/new/lib/renderer.ts'
import { formatGeneratedProject, verifyGeneratedProject } from 'utils/verify.ts'
import { assertSafeProjectName } from 'utils/projects/validate-name.ts'
import logger from '@zanix/logger'

/**
 * `zanix new space`'s real orchestration: rejects a `..` path-traversal segment in `appName`
 * (`assertSafeProjectName`) and validates `--renderer` (`assertValidRenderer` — either failure
 * routes through `this.throw`, same as an unknown `--template`, all before
 * anything is written), resolves the tree, writes it, then
 * `ensureSpaceScaffoldSideEffects`, saves `deno.json`'s Zanix config, then — both independently
 * opt-in, off by default — `--verify`s the generated project and/or `--prepare`s it (`zanix
 * prepare <name> --project-type=space -g -e`, unless `--no-prepare` was passed).
 *
 * `template` (`options.template`) is typed as a plain `string`, not `ZanixTemplates` (`@zanix/
 * types`'s own published literal, `'base'` only) — `--template`'s real validation is
 * `assertKnownPreset`/`resolveRecipe` (both runtime, both already reached via `getZanixPaths`
 * below), never a TS literal; `ZanixTemplates` only ever describes `ZanixTemplatesRecord`'s own
 * single `'base'` key (see the `createFilesAndFolders` call below), a different concept from which
 * PRESET a project was built with. `'welcome'` (`getSpaceRecipes`, `space.ts`) is the one other
 * real, valid `--template` value this action accepts.
 *
 * `theme` (`options.theme`) is validated separately, via `assertKnownTheme` — an independent axis
 * from `template` (see `themes.ts`'s own doc), so an invalid value fails the same way (`this.throw`,
 * before anything is written) without being confused for an unknown `--template`.
 *
 * `createFilesAndFolders(structure, 'base')` passes the literal `'base'`, never `template` —
 * `template` is `--template`'s own value (which Recipe built this tree's content), a different
 * concept from `createFilesAndFolders`'s second argument, which selects a key of
 * `ZanixTemplatesRecord` (`obj.templates?.[key]`) on each tree node. Every node this CLI ever
 * builds only ever has ONE such key, `'base'` — `assembleScaffold` (`recipe.ts`) always writes
 * `{ base: [...] }`, regardless of which preset filled it (see `presets.ts`'s own doc: a preset
 * selects WHICH content lands in that one bucket, never a different bucket). Passing `template`
 * here instead would look up `structure.templates?.['welcome']` for a `'welcome'` scaffold —
 * always `undefined`, on every node — silently writing nothing at all, anywhere in the tree.
 *
 * `--icons` (`options.icons`, plain boolean, default `false`) is forwarded ONLY to
 * `ensureSpaceScaffoldSideEffects` (so the actual catalog files get copied AND
 * `src/space/catalog-icon.ts` gets generated — see `space-icons.ts`'s own doc), never to
 * `getZanixPaths` — `space.app.ts`'s `assetsDir` field is unconditional now (see
 * `getSpaceAppTemplate`'s own doc for why: production correctness, not an icons-specific
 * concern), so `getZanixPaths` no longer needs to know whether `--icons` was passed at all.
 * `--icons` is never validated the way `--renderer`/`--template` are, since Cliffy's own
 * boolean-flag parsing already makes an invalid value structurally impossible. `renderer`
 * (already resolved above) is forwarded to `ensureSpaceScaffoldSideEffects` alongside it, purely
 * so that generated wrapper imports the matching `@zanix/space-ui` entrypoint.
 *
 * `ensureSpaceUiDependency` runs AFTER `saveZanixConfig`, never before, and only when
 * `ensureSpaceScaffoldSideEffects` itself reports the icon catalog actually landed on disk, OR
 * `template === 'welcome'`/`'population'`/`'population-lang'`, OR `theme === 'astronaut'`, OR
 * `pages.includes('error')` — see that function's own doc and `ensureSpaceUiDependency`'s own doc
 * (`space-icons.ts`) for exactly why this ordering is load-bearing: `ensureZanixDependency`
 * reads/writes `deno.json` directly, which doesn't exist on disk until `saveZanixConfig` writes it.
 * `'welcome'`'s own `routes/page.tsx` (`space-welcome.ts`), `'population'`/`'population-lang'`'s own
 * `routes/page.tsx` (`space-population.ts` — `IntlProvider`/`Link`/`useIntl`), `'astronaut'`'s own
 * `comets/example.comet.tsx` (`space-astronaut.ts`), and `--pages=error`'s own `routes/error.tsx`
 * (`errorTemplate`'s own `Button`) all import from `@zanix/space-ui` unconditionally, independent
 * of `--icons` — this condition is what actually declares that import in the generated
 * `deno.json`, the same never-clobber `ensureZanixDependency` call `--icons` already uses, just
 * reached by a different, orthogonal precondition.
 *
 * `theme === 'default'` deliberately does NOT join this condition — unlike `'astronaut'`,
 * `--theme default`'s own output (`space-theme.ts`'s copied `theme/*.css`) is plain CSS,
 * never a `.ts` import, so no `deno.json` dependency is ever needed for it.
 *
 * `--pages` (`options.pages`, a comma-separated string, e.g. `'error,not-found'`) is parsed and
 * validated (`parsePagesFlag`/`assertKnownPages`) alongside `--renderer`/`--theme` above — same
 * "fail before anything is written" ordering — then forwarded to
 * `ensureSpaceScaffoldSideEffects`, which writes the requested files by reusing
 * `zanix generate error`/`zanix generate not-found`'s own template functions directly (see
 * `space-pages.ts`'s own doc).
 */
async function newSpaceAction(
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
  appName: string = 'my-zanix-space',
) {
  const projectType = 'space'
  const { template, prepare, verify, icons, theme } = options

  let structure: ReturnType<typeof getZanixPaths<typeof projectType>>
  let renderer: RendererName
  let pages: ReturnType<typeof parsePagesFlag>
  try {
    assertSafeProjectName(appName)
    renderer = assertValidRenderer(options.renderer)
    if (theme !== undefined) assertKnownTheme(theme)
    pages = parsePagesFlag(options.pages)
    assertKnownPages(pages)
    structure = getZanixPaths(projectType, appName, template, renderer, theme as ThemeName)
  } catch (error) {
    this.throw(error as Error)
    return
  }

  await createFilesAndFolders(structure, 'base')
  const iconsReady = await ensureSpaceScaffoldSideEffects(
    structure.FOLDER,
    template,
    icons,
    renderer,
    theme as ThemeName,
    pages,
  )

  await saveZanixConfig(projectType, appName, renderer)
  if (
    iconsReady || template === 'welcome' || template === 'population' ||
    template === 'population-lang' || theme === 'astronaut' || pages.includes('error') ||
    // `--pages not-found`'s own template only imports `@zanix/space-ui` (`IntlProvider`/`useIntl`)
    // when the project already has `messages/` — written by `population`/`population-lang` above,
    // by the time this check runs (`ensureSpaceScaffoldSideEffects` already returned).
    (pages.includes('not-found') && getProjectMessageLangs(structure.FOLDER) !== undefined)
  ) {
    await ensureSpaceUiDependency(structure.FOLDER)
  }

  await formatGeneratedProject(structure.FOLDER)

  if (verify) await verifyGeneratedProject(structure.FOLDER)

  if (prepare) {
    await this.runCommand('prepare', [
      appName,
      `--project-type=${projectType}`,
      '-g',
      '-e',
    ])
  }

  logger.info(
    `Space app created sucessfully in the '${appName}' folder using the '${template}' ` +
      `template (renderer: '${renderer}').`,
  )
}

export default newSpaceAction
