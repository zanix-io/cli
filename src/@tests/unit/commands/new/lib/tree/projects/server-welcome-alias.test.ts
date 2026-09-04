import { assertEquals } from '@std/assert'
import { getServerSrcTree, SERVER_RECIPES } from 'commands/new/lib/tree/projects/server.ts'

/**
 * `SERVER_RECIPES.welcome`/`population`/`population-lang` are deliberate ALIASES for
 * `SERVER_RECIPES.base` (see `server.ts`'s own doc) — proves each alias holds for real, not just
 * that the keys happen to exist: same recipe array reference, and `getServerSrcTree(root, <alias>)`
 * produces the exact same file list as `getServerSrcTree(root, 'base')`. This exists solely so
 * `zanix new spacecraft --template welcome`/`population`/`population-lang` can resolve at all
 * (`getZnxFolderTree` threads the same `preset` into both `getSpaceSrcTree` AND `getServerSrcTree`
 * for `space-server`) — none of the three has any server-specific content of its own.
 */
const namesOf = (node: unknown) => {
  const names: string[] = []
  const walk = (n: unknown) => {
    // deno-lint-ignore no-explicit-any
    const casted = n as any
    for (const file of casted?.templates?.base ?? []) names.push(file.NAME)
    for (const sub of Object.values(casted?.subfolders ?? {})) walk(sub)
  }
  walk(node)
  return names.sort()
}

for (const alias of ['welcome', 'population', 'population-lang'] as const) {
  Deno.test(
    `SERVER_RECIPES.${alias} is the exact same array as SERVER_RECIPES.base, not a copy`,
    () => {
      assertEquals(SERVER_RECIPES[alias], SERVER_RECIPES.base)
      assertEquals(SERVER_RECIPES[alias] === SERVER_RECIPES.base, true)
    },
  )

  Deno.test(
    `getServerSrcTree(root, '${alias}') produces the exact same file names as (root, 'base')`,
    () => {
      const baseTree = getServerSrcTree(`server-${alias}-alias-base`, 'base')
      const aliasTree = getServerSrcTree(`server-${alias}-alias-target`, alias)

      assertEquals(namesOf(aliasTree), namesOf(baseTree))
    },
  )
}
