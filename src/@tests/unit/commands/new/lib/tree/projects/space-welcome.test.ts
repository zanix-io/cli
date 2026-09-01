import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert'
import {
  planWelcomePage,
  welcomePageTemplate,
} from 'commands/new/lib/tree/projects/space-welcome.ts'
import { getSpaceRecipes, getSpaceSrcTree } from 'commands/new/lib/tree/projects/space.ts'

// ================================================================================================
// welcomePageTemplate/planWelcomePage — pure string builders, no I/O, so both stay testable at
// unit tier (same reasoning `page/command.ts`'s own `planPage`/`pageTemplate` tests already use).
// ================================================================================================

Deno.test('welcomePageTemplate renders a real @Page()/SpacePageController component', () => {
  const content = welcomePageTemplate()

  assertMatch(content, /import \{ Page, SpacePageController \} from '@zanix\/space'/)
  assertMatch(content, /@Page\(\)/)
  assertMatch(content, /export default class WelcomePage extends SpacePageController/)
  assertMatch(content, /public static override head = \{ title: 'Welcome to Zanix Space' \}/)
  assertMatch(content, /public override component = WelcomeView/)
})

Deno.test(
  "welcomePageTemplate composes @zanix/space-ui's real Link, never CatalogIcon/SocialNetworks",
  () => {
    const content = welcomePageTemplate()

    assertMatch(content, /import \{ Link \} from '@zanix\/space-ui'/)
    assert(
      !content.includes('CatalogIcon') && !content.includes('SocialNetworks'),
      'the welcome page must stay independent of --icons — no CatalogIcon/SocialNetworks reference',
    )
  },
)

Deno.test(
  'welcomePageTemplate\'s root <main> carries a stable data-space="content" hook — the same ' +
    '@zanix/space attribute convention DefaultNotFoundView/DefaultErrorView establish, shared ' +
    "verbatim with --template population's own root element, so any --theme value's own starter " +
    'CSS only ever needs one selector to target either',
  () => {
    const content = welcomePageTemplate()
    assertMatch(content, /<main data-space='content'>/)
  },
)

Deno.test('welcomePageTemplate links to real, current zanix-io GitHub URLs, both external', () => {
  const content = welcomePageTemplate()

  assertMatch(
    content,
    /<Link href='https:\/\/github\.com\/zanix-io\/space' external>Documentation<\/Link>/,
  )
  assertMatch(content, /<Link href='https:\/\/github\.com\/zanix-io' external>GitHub<\/Link>/)
})

Deno.test('planWelcomePage writes exactly one file, at <folder>/page.tsx', async () => {
  const plan = planWelcomePage('/tmp/some-project/src/space/routes')

  assertEquals(plan.files.length, 1)
  assertEquals(plan.files[0].PATH, '/tmp/some-project/src/space/routes/page.tsx')
  assertEquals(plan.files[0].NAME, 'page.tsx')
  assertEquals(await plan.files[0].content(), welcomePageTemplate())
})

// ================================================================================================
// getSpaceRecipes().welcome — proves the recipe is actually wired, not just the standalone planner
// function existing in isolation (mirrors `zanix-app-recipe.test.ts`'s own `APP_RECIPES` checks).
// ================================================================================================

Deno.test('getSpaceRecipes() has an entry for every real --template value', () => {
  assertEquals(
    Object.keys(getSpaceRecipes()).sort(),
    ['base', 'population', 'population-lang', 'welcome'],
  )
})

Deno.test(
  "getSpaceSrcTree(root, 'welcome') writes the real welcome page.tsx, not the generic Example one",
  () => {
    const tree = getSpaceSrcTree('space-welcome-recipe-test', 'welcome')

    const routeFiles = tree.subfolders.routes.templates.base
    assertEquals(routeFiles.map((f) => f.NAME), ['page.tsx'])
  },
)

Deno.test(
  "getSpaceSrcTree(root, 'welcome') still seeds the same example Comet as 'base' — Comet content " +
    'is theme-owned, not template-owned, and neither call here sets a theme',
  () => {
    const tree = getSpaceSrcTree('space-welcome-recipe-comet-test', 'welcome')

    const cometFiles = tree.subfolders.comets.templates.base
    assertEquals(cometFiles.map((f) => f.NAME), ['example.comet.tsx'])
  },
)

Deno.test(
  "getSpaceSrcTree(root, 'base') vs (root, 'welcome') produce different routes/page.tsx content",
  async () => {
    const baseTree = getSpaceSrcTree('space-preset-diff-base', 'base')
    const welcomeTree = getSpaceSrcTree('space-preset-diff-welcome', 'welcome')

    const baseContent = await baseTree.subfolders.routes.templates.base[0].content({
      metaUrl: import.meta.url,
    })
    const welcomeContent = await welcomeTree.subfolders.routes.templates.base[0].content({
      metaUrl: import.meta.url,
    })

    assert(baseContent !== welcomeContent, 'base and welcome must not render the same page.tsx')
    assertMatch(welcomeContent, /WelcomePage/)
  },
)

// ================================================================================================
// welcomePageTemplate(theme) — the same page.tsx content adapts to `theme === 'astronaut'`
// specifically, never to any other value: the astronaut badge/Comet-launch copy only appear when
// that CSS/Comet content actually exists (see `space.ts`'s own doc for why Comet selection is
// theme-owned).
// ================================================================================================

Deno.test(
  'welcomePageTemplate(): with no theme, never renders the astronaut-only badge, and describes ' +
    'the plain placeholder Comet, never the launch demo',
  () => {
    const content = welcomePageTemplate()
    assertFalse(content.includes('welcome-emoji'), content)
    assertFalse(content.includes('launches a real comet'), content)
  },
)

Deno.test(
  "welcomePageTemplate('default'): the generic theme gets the same content as no theme at all — " +
    "'default' has no astronaut-specific copy of its own",
  () => {
    assertEquals(welcomePageTemplate('default'), welcomePageTemplate())
  },
)

Deno.test(
  "welcomePageTemplate('astronaut'): renders the astronaut badge and describes the real launch " +
    'demo, mentioning the theme by name',
  () => {
    const content = welcomePageTemplate('astronaut')
    assert(content.includes('welcome-emoji'), content)
    assert(content.includes('astronaut theme'), content)
    assert(content.includes('launches a real comet'), content)
  },
)

Deno.test('planWelcomePage(folder, theme) forwards theme into the written page.tsx content', async () => {
  const plan = planWelcomePage('/tmp/some-project/src/space/routes', 'astronaut')
  assertEquals(await plan.files[0].content(), welcomePageTemplate('astronaut'))
})

// ================================================================================================
// Comet selection is theme-owned, not template-owned — `getSpaceSrcTree` picks the interactive
// launch demo ONLY when `theme === 'astronaut'`, regardless of `--template`, for both `base` and
// `welcome` alike.
// ================================================================================================

Deno.test(
  "getSpaceSrcTree(root, 'welcome', 'astronaut') writes the interactive launch-demo Comet, not " +
    'the generic placeholder',
  async () => {
    const tree = getSpaceSrcTree('space-welcome-astronaut-comet-test', 'welcome', 'astronaut')
    const cometFiles = tree.subfolders.comets.templates.base
    assertEquals(cometFiles.map((f) => f.NAME), ['example.comet.tsx'])
    const content = await cometFiles[0].content({ metaUrl: import.meta.url })
    assert(content.includes('comet-launchpad'), content)
  },
)

Deno.test(
  "getSpaceSrcTree(root, 'base', 'astronaut') ALSO writes the interactive launch-demo Comet — " +
    'Comet content follows theme, independent of which --template value is active',
  async () => {
    const tree = getSpaceSrcTree('space-base-astronaut-comet-test', 'base', 'astronaut')
    const cometFiles = tree.subfolders.comets.templates.base
    const content = await cometFiles[0].content({ metaUrl: import.meta.url })
    assert(content.includes('comet-launchpad'), content)
  },
)

// ================================================================================================
// welcomePageTemplate(theme, renderer) — the ONE remaining variable this page's own
// `@zanix/space-ui` import must track: which renderer built the project. Mirrors
// `space-app-template.test.ts`'s own renderer-entrypoint checks for `getSpaceAppTemplate`, and
// `space-icons.test.ts`'s own checks for `getCatalogIconWrapperTemplate` — the same
// `getSpaceUiEntry` helper (`lib/renderer.ts`) backs all three now.
// ================================================================================================

Deno.test(
  'welcomePageTemplate: renderer omitted, or explicitly react, imports Link from the React ' +
    'entrypoint — never /preact',
  () => {
    for (const content of [welcomePageTemplate(), welcomePageTemplate(undefined, 'react')]) {
      assertMatch(content, /import \{ Link \} from '@zanix\/space-ui'/)
      assertFalse(content.includes('@zanix/space-ui/preact'), content)
    }
  },
)

Deno.test(
  "welcomePageTemplate(theme, 'preact') imports Link from '@zanix/space-ui/preact' instead, " +
    'regardless of theme',
  () => {
    for (
      const content of [
        welcomePageTemplate(undefined, 'preact'),
        welcomePageTemplate('astronaut', 'preact'),
      ]
    ) {
      assertMatch(content, /import \{ Link \} from '@zanix\/space-ui\/preact'/)
      assertFalse(content.includes("from '@zanix/space-ui'\n"), content)
    }
  },
)

Deno.test(
  'planWelcomePage(folder, theme, renderer) forwards renderer into the written page.tsx content',
  async () => {
    const plan = planWelcomePage('/tmp/some-project/src/space/routes', 'astronaut', 'preact')
    assertEquals(await plan.files[0].content(), welcomePageTemplate('astronaut', 'preact'))
  },
)

// ================================================================================================
// getSpaceSrcTree(root, preset, theme, renderer) — the renderer-aware fix must reach BOTH the
// `welcome` page and the theme-owned Comet demo, for every `--template` value, not just `welcome`
// (the same "Comet follows theme, not template" rule the tests above already establish for
// `theme`).
// ================================================================================================

Deno.test(
  "getSpaceSrcTree(root, 'welcome', 'astronaut', 'preact') writes a Preact-flavored welcome page",
  async () => {
    const tree = getSpaceSrcTree(
      'space-welcome-astronaut-preact-test',
      'welcome',
      'astronaut',
      'preact',
    )
    const content = await tree.subfolders.routes.templates.base[0].content({
      metaUrl: import.meta.url,
    })
    assertMatch(content, /import \{ Link \} from '@zanix\/space-ui\/preact'/)
  },
)

Deno.test(
  "getSpaceSrcTree(root, 'base', 'astronaut', 'preact') writes a Preact-flavored Comet demo — " +
    "'base' shares the SAME theme-owned Comet fix 'welcome' gets, since the comet leaf is theme-" +
    'driven regardless of --template',
  async () => {
    const tree = getSpaceSrcTree(
      'space-base-astronaut-preact-comet-test',
      'base',
      'astronaut',
      'preact',
    )
    const content = await tree.subfolders.comets.templates.base[0].content({
      metaUrl: import.meta.url,
    })
    assert(content.includes("from '@zanix/space-ui/preact'"), content)
    assert(content.includes("from 'preact/hooks'"), content)
    assertFalse(content.includes("from 'react'"), content)
  },
)
