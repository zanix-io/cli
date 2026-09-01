import { assert, assertFalse } from '@std/assert'
import { getSpaceAppTemplate } from 'commands/new/lib/tree/projects/space.ts'
import { getThemedGlobalCssPaths } from 'commands/new/lib/tree/projects/space-theme.ts'
import { getAstronautGlobalCssPaths } from 'commands/new/lib/tree/projects/space-astronaut.ts'

// Same shape as `space-app-template.test.ts`'s own renderer/assetsDir coverage, kept as a separate
// file (not folded into it) since `theme` is an independent axis from `renderer` — see `space.ts`'s
// own `getSpaceAppTemplate` doc for why both are parameters of the same function without being
// coupled to each other.

Deno.test(
  'getSpaceAppTemplate: theme omitted never writes a globalCss field',
  () => {
    const content = getSpaceAppTemplate('storefront')
    assertFalse(content.includes('globalCss'), content)
  },
)

Deno.test(
  "getSpaceAppTemplate: theme: 'default' writes the real, complete globalCss list, in order",
  () => {
    const content = getSpaceAppTemplate('storefront', undefined, 'default')
    assert(content.includes('globalCss: ['), content)
    for (const cssPath of getThemedGlobalCssPaths()) {
      assert(content.includes(`'${cssPath}',`), `must list ${cssPath}:\n${content}`)
    }
    // Order matters — tokens.css must appear before the files that consume its custom properties.
    const tokensIndex = content.indexOf('tokens.css')
    const behaviorIndex = content.indexOf('behavior.css')
    assert(tokensIndex > -1 && behaviorIndex > -1 && tokensIndex < behaviorIndex, content)
  },
)

Deno.test(
  "getSpaceAppTemplate: theme: 'astronaut' writes ITS OWN complete globalCss list, distinct from " +
    "'default'",
  () => {
    const content = getSpaceAppTemplate('storefront', undefined, 'astronaut')
    assert(content.includes('globalCss: ['), content)
    for (const cssPath of getAstronautGlobalCssPaths()) {
      assert(content.includes(`'${cssPath}',`), `must list ${cssPath}:\n${content}`)
    }
    // Astronaut's own extra file — never part of 'default''s list.
    assert(content.includes("'./theme/astronaut.css',"), content)
    const defaultContent = getSpaceAppTemplate('storefront', undefined, 'default')
    assertFalse(defaultContent.includes('astronaut.css'), defaultContent)
  },
)

Deno.test(
  'getSpaceAppTemplate: theme never adds a SECOND assetsDir field of its own — assetsDir is ' +
    'already unconditional (see space-app-template.test.ts), and theme CSS lives at ./theme/, ' +
    "outside assetsDir's own scan path, so a theme never touches that field at all",
  () => {
    const defaultContent = getSpaceAppTemplate('storefront', undefined, 'default')
    const astronautContent = getSpaceAppTemplate('storefront', undefined, 'astronaut')
    assert(defaultContent.match(/assetsDir/g)?.length === 1, defaultContent)
    assert(astronautContent.match(/assetsDir/g)?.length === 1, astronautContent)
  },
)

Deno.test(
  'getSpaceAppTemplate: theme and renderer are fully independent',
  () => {
    const reactThemed = getSpaceAppTemplate('storefront', 'react', 'default')
    const preactThemed = getSpaceAppTemplate('storefront', 'preact', 'default')

    assert(reactThemed.includes("import '@zanix/space/react'"))
    assert(reactThemed.includes('globalCss'))
    assert(preactThemed.includes("import '@zanix/space/preact'"))
    assert(preactThemed.includes('globalCss'))
  },
)
