import type { ZanixFolderTree } from '@zanix/types'

import {
  assembleScaffold,
  resolveRecipe,
  type ScaffoldRecipeEntry,
  type ScaffoldRecipeRegistry,
} from 'commands/new/lib/tree/recipe.ts'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { getFolderName, toKebabCase } from '@zanix/helpers'
import { join } from '@std/path'

/**
 * `mod.ts` for `zanix new app` — a real, working `defineZanixApp()` manifest (never an empty
 * placeholder file). Deliberately protocol-agnostic: a Zanix App is `manifest + dependencies +
 * resources + routes + jobs + events + lifecycle` — nothing about it requires an HTTP server, so
 * this scaffold never assumes `routes`/a `@Controller` (that would bias every generated app
 * toward looking like a mini server). `onStart`/`onStop` are the one piece every app shape — REST
 * routes, `@zanix/asyncmq` jobs, or plain background work — actually has in common; add
 * `routes`/`jobs`/`dependencies`/`resources` once the app actually needs them, following
 * `@zanix/app`'s own manifest reference.
 *
 * Lint-clean against the project's OWN scaffolded rules, not just formatted: logs through the real
 * Zanix `logger` (`@zanix/utils/logger`), never `console` — `no-znx-console` has a real auto-fix
 * (`@zanix/utils`'s own `zanix-logger.ts` source, already inside `cli`'s own pinned
 * `@zanix/utils@^4.1.0` floor), so the installed pre-commit hook's `deno lint --fix` would rewrite
 * a `console` call here on its own — logging through `logger` directly avoids that unnecessary
 * rewrite on a project's very first commit. The default export is explicitly typed via
 * `as ZanixAppDefinition` — confirmed empirically (`deno publish --dry-run`,
 * no `--allow-slow-types`) to satisfy JSR's fast-check analyzer; a bare `defineZanixApp({...})`
 * default export trips `unsupported-default-export-expr` (fast-check can't infer the type of a
 * default export expression on its own).
 *
 * Generated locally, same reasoning as `server.ts`/`space.ts`'s own header comments: `@zanix/app`
 * has no `src/templates/` directory for this to resolve against via a JSR fetch.
 */
export const getAppModTemplate = (appName: string): string => {
  const name = toKebabCase(appName)

  return `import { defineZanixApp, type ZanixAppDefinition } from '@zanix/app'
import logger from '@zanix/utils/logger'

/**
 * Example Zanix App manifest — a Zanix App is \`manifest + dependencies + resources + routes +
 * jobs + events + lifecycle\`; nothing here requires an HTTP server. Add \`routes\`/\`jobs\`/
 * \`dependencies\`/\`resources\` as this app actually needs them — see \`@zanix/app\`'s own README for
 * the full manifest reference and \`.serve()\` (a one-app, isolated dev loop), and its
 * \`docs/publishing.md\` if you're distributing this as a package for a different team's host to
 * install.
 */
export default defineZanixApp({
  name: '${name}',
  onStart: () => {
    logger.info('${name} started')
  },
}) as ZanixAppDefinition
`
}

// `app` has no dedicated `src/app` subfolder of its own — its only real artifact is the root
// `mod.ts` itself (see `main.ts`'s own comment on why), so this recipe's single entry targets the
// whole tree, not a subfolder leaf the way `SERVER_RECIPE_BASE`/`SPACE_RECIPE_BASE` do.
const APP_RECIPE_BASE: ScaffoldRecipeEntry<ZanixFolderTree<'app'>>[] = [
  {
    leaf: (tree) => tree,
    plan: (folder) => ({
      files: [{
        PATH: join(folder, MAIN_MODULE),
        NAME: MAIN_MODULE,
        content: () => Promise.resolve(getAppModTemplate(getFolderName(folder))),
      }],
    }),
  },
]

/** `app`'s whole preset registry — see `server.ts`'s own `SERVER_RECIPES` doc, same shape and same
 * reasoning, just for `app`'s single root-level `mod.ts` entry. */
export const APP_RECIPES: ScaffoldRecipeRegistry<ZanixFolderTree<'app'>> = {
  base: APP_RECIPE_BASE,
}

/**
 * Resolves and runs `app`'s own recipe against the already-built whole-project `tree` — gives `app`
 * the same per-type `resolveRecipe` validation (defense in depth beyond the global
 * `assertKnownPreset` check `getZnxFolderTree` already runs) that `server`/`space` get for their own
 * content. Mutates `tree` in place, same as `assembleScaffold` always does — `main.ts` calls this
 * instead of hand-pushing `mod.ts` onto `tree.templates.base` directly.
 *
 * Appends onto whatever `tree.templates.base` already holds (`assembleScaffold`'s own append
 * semantics, not a replace) — `commons.ts` (`getCommonTree`) always populates the same root node
 * with `README.md`/`CHANGELOG.md`/`LICENSE`/etc *before* this runs, and this call must add to that,
 * never replace it.
 */
export function assembleAppScaffold(
  tree: ZanixFolderTree<'app'>,
  preset: string = 'base',
): void {
  const recipe = resolveRecipe(APP_RECIPES, preset)
  assembleScaffold(tree, recipe)
}
