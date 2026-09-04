import { assert, assertEquals, assertThrows } from '@std/assert'
import { APP_RECIPES, assembleAppScaffold } from 'commands/new/lib/tree/projects/app.ts'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'

Deno.test(
  'APP_RECIPES only has a base entry — same registry shape as SERVER_RECIPES/SPACE_RECIPES, ' +
    'just no second preset of its own yet',
  () => {
    assertEquals(Object.keys(APP_RECIPES), ['base'])
  },
)

Deno.test('assembleAppScaffold appends mod.ts without wiping commons.ts content', () => {
  const paths = getZanixPaths('app', 'app-recipe-append-test')

  const names = paths.templates.base.map((f) => f.NAME)
  assert(
    names.includes('README.md'),
    'commons.ts content must survive assembleAppScaffold',
  )
  assert(
    names.includes('LICENSE'),
    'commons.ts content must survive assembleAppScaffold',
  )
  assert(names.includes('mod.ts'), "app's own mod.ts must be appended")
})

Deno.test('assembleAppScaffold fails clearly for an unknown preset', () => {
  const paths = getZanixPaths('app', 'app-recipe-unknown-preset-tree')
  assertThrows(
    () => assembleAppScaffold(paths, 'does-not-exist'),
    Error,
    "Unknown template 'does-not-exist'",
  )
})
