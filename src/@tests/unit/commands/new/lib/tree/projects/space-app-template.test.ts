import { assert, assertFalse } from '@std/assert'
import { getSpaceAppTemplate } from 'commands/new/lib/tree/projects/space.ts'

Deno.test(
  'getSpaceAppTemplate: renderer omitted never writes a renderer field — react is the ' +
    "default @zanix/space itself already assumes when it's absent",
  () => {
    const content = getSpaceAppTemplate('storefront')
    assertFalse(content.includes('renderer'), content)
  },
)

Deno.test(
  "getSpaceAppTemplate: always writes clientBuildDir: './.dist/client', unconditionally — " +
    'independent of renderer/theme, so a scaffolded app auto-loads its production build output ' +
    'with zero manual configuration',
  () => {
    for (
      const content of [
        getSpaceAppTemplate('storefront'),
        getSpaceAppTemplate('storefront', 'preact'),
        getSpaceAppTemplate('storefront', undefined, 'default'),
        getSpaceAppTemplate('storefront', undefined, 'astronaut'),
      ]
    ) {
      assert(content.includes("clientBuildDir: './.dist/client',"), content)
    }
  },
)

Deno.test(
  "getSpaceAppTemplate: always writes assetsDir: './assets', unconditionally — independent of " +
    'renderer/theme, since @zanix/space only registers its /assets/:path* route (which serves ' +
    "clientBuildDir's own hashed JS/CSS output) when assetsDir is declared; a scaffold that " +
    'omitted it would 404 its own production build the moment one ran',
  () => {
    for (
      const content of [
        getSpaceAppTemplate('storefront'),
        getSpaceAppTemplate('storefront', 'preact'),
        getSpaceAppTemplate('storefront', undefined, 'default'),
        getSpaceAppTemplate('storefront', undefined, 'astronaut'),
      ]
    ) {
      assert(content.includes("assetsDir: './assets',"), content)
    }
  },
)

Deno.test(
  "getSpaceAppTemplate: renderer: 'react' explicitly is identical to omitting it",
  () => {
    assert(
      getSpaceAppTemplate('storefront', 'react') === getSpaceAppTemplate('storefront'),
    )
  },
)

Deno.test(
  "getSpaceAppTemplate: renderer: 'preact' writes a real renderer: 'preact' field into the " +
    'generated defineSpaceApp({ ... }) call',
  () => {
    const content = getSpaceAppTemplate('storefront', 'preact')
    assert(content.includes("renderer: 'preact',"), content)
    assert(
      content.includes(
        "import { createNotFoundHandler, defineBootstrapSpaceAppConfig, defineSpaceApp } from '@zanix/space'",
      ),
      content,
    )
    assert(content.includes("name: 'storefront',"), content)
  },
)

// ================================================================================================
// The renderer ENTRY POINT — `@zanix/space` ships no renderer implementation, so a scaffold that
// only declared `renderer` would produce a project that fails on its first render. These cases pin
// the other half: the generated manifest always installs exactly one runtime, and it is always the
// one it declares.
// ================================================================================================

Deno.test(
  "getSpaceAppTemplate: a react scaffold imports '@zanix/space/react' as its very first line — " +
    '`@zanix/space` itself installs no renderer, so the manifest has to',
  () => {
    for (
      const content of [
        getSpaceAppTemplate('storefront'),
        getSpaceAppTemplate('storefront', 'react'),
      ]
    ) {
      assert(content.startsWith("import '@zanix/space/react'\n"), content)
      assert(!content.includes('@zanix/space/preact'), content)
    }
  },
)

Deno.test(
  "getSpaceAppTemplate: a preact scaffold imports '@zanix/space/preact' instead, and never React's",
  () => {
    const content = getSpaceAppTemplate('storefront', 'preact')

    assert(content.startsWith("import '@zanix/space/preact'\n"), content)
    assert(!content.includes("'@zanix/space/react'"), content)
  },
)

Deno.test(
  'getSpaceAppTemplate: the installed entry point and the declared renderer always agree — the ' +
    'two halves come from the same argument, and `@zanix/space` rejects a mismatch at startup',
  () => {
    const preact = getSpaceAppTemplate('storefront', 'preact')
    assert(
      preact.includes("import '@zanix/space/preact'") && preact.includes("renderer: 'preact',"),
    )

    // React's manifest omits the field (that IS `defineSpaceApp`'s default), so agreement here means
    // the React entry point plus no contradicting declaration.
    const react = getSpaceAppTemplate('storefront')
    assert(react.includes("import '@zanix/space/react'") && !react.includes('renderer:'))
  },
)
