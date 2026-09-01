import { assert, assertEquals, assertFalse } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { join } from '@std/path'
import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import {
  applyPopulationScaffold,
  planPopulationPage,
  POPULATION_DEMO_NAME,
} from 'commands/new/lib/tree/projects/space-population.ts'
import { getSpaceRecipes, getSpaceSrcTree } from 'commands/new/lib/tree/projects/space.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

/** Every named-argument identifier an ICU message actually requires at format time — walks
 * argument/number/date/time/select/plural nodes (and recurses into select/plural option bodies),
 * the same shape `@formatjs/intl`'s own `IntlMessageFormat` reads. Used to catch the exact bug
 * class `population/overrideHint` once had: a literal `{lang}` in the catalog text that ICU parses
 * as a REQUIRED argument, even though the page's own `formatMessage(id, values)` call never passes
 * one — `@formatjs/intl` throws `FORMAT_ERROR` at render time for that, not at parse time, so
 * nothing short of actually parsing (or rendering) the message catches it. */
function collectArgNames(elements: MessageFormatElement[]): Set<string> {
  const names = new Set<string>()
  for (const element of elements) {
    // deno-lint-ignore no-explicit-any
    const withValue = element as any
    // TYPE.literal's own `.value` is the literal text, not an argument name — only
    // argument/number/date/time/select/plural nodes actually name a required format argument.
    if (withValue.type !== TYPE.literal && typeof withValue.value === 'string') {
      names.add(withValue.value)
    }
    if (withValue.options) {
      for (
        const option of Object.values(withValue.options) as { value: MessageFormatElement[] }[]
      ) {
        for (const name of collectArgNames(option.value)) names.add(name)
      }
    }
  }
  return names
}

// ================================================================================================
// planPopulationPage — pure string builder, no I/O. `withLang` picks the written path AND the page
// content's own lang-handling branch; theme is accepted but unused (this preset's own content is
// identical regardless of --theme, unlike welcome's — see the module's own doc).
// ================================================================================================

Deno.test(
  'planPopulationPage(folder, theme, renderer, false) writes exactly one file, at ' +
    '<folder>/page.tsx',
  () => {
    const plan = planPopulationPage(
      '/tmp/some-project/src/space/routes',
      undefined,
      undefined,
      false,
    )

    assertEquals(plan.files.length, 1)
    assertEquals(plan.files[0].PATH, '/tmp/some-project/src/space/routes/page.tsx')
    assertEquals(plan.files[0].NAME, 'page.tsx')
  },
)

Deno.test(
  'planPopulationPage(folder, theme, renderer, true) writes at <folder>/[lang]/page.tsx instead',
  () => {
    const plan = planPopulationPage(
      '/tmp/some-project/src/space/routes',
      undefined,
      undefined,
      true,
    )

    assertEquals(plan.files.length, 1)
    assertEquals(plan.files[0].PATH, '/tmp/some-project/src/space/routes/[lang]/page.tsx')
    assertEquals(plan.files[0].NAME, 'page.tsx')
  },
)

// ================================================================================================
// Page content — !withLang: a single implicit 'default' locale, no params.lang, no lang-switcher
// copy, a plain (non-generic) SpacePageController.
// ================================================================================================

Deno.test(
  'planPopulationPage(..., false): a real @Page()/SpacePageController component, hardcoded ' +
    "implicit lang 'default', no /[lang]/ awareness at all",
  async () => {
    const content = await planPopulationPage('routes', undefined, undefined, false).files[0]
      .content()

    assert(content.includes('@Page()'))
    assert(content.includes('class ExamplePage extends SpacePageController {'))
    assert(content.includes("const lang = 'default'"))
    assertFalse(content.includes('ctx.params.lang'), content)
    assertFalse(content.includes('Current language'), content)
    assertFalse(content.includes('langGuard'), content)
  },
)

// ================================================================================================
// Page content — withLang: resolves lang from the matched route param, shows a lang switcher hint,
// and points at the langGuard()/langPreHandler wiring actually running the request.
// ================================================================================================

Deno.test(
  'planPopulationPage(..., true): resolves lang from ctx.params.lang, typed PageContext<{ lang: ' +
    'string }>, extends SpacePageController<{ lang: string }>, and mentions the lang switcher',
  async () => {
    const content = await planPopulationPage('routes', undefined, undefined, true).files[0]
      .content()

    assert(content.includes('const lang = ctx.params.lang'))
    assert(content.includes('class ExamplePage extends SpacePageController<{ lang: string }>'))
    assert(content.includes('ctx: PageContext<{ lang: string }>'))
    assert(content.includes('Current language'))
    assert(content.includes('langGuard()'))
    assert(content.includes('definePreHandler(langPreHandler(...))'))
  },
)

Deno.test(
  'planPopulationPage(..., true): ExampleContent actually receives lang as a prop — a real ' +
    'regression once left it referencing an out-of-scope `lang`, a ReferenceError only a live ' +
    'SSR render surfaced (never a type error, since JSX text is untyped)',
  async () => {
    const content = await planPopulationPage('routes', undefined, undefined, true).files[0]
      .content()

    assert(
      content.includes(
        'function ExampleContent({ lang, population }: { lang: string; ' +
          'population?: string }) {',
      ),
      content,
    )
    assert(content.includes('<ExampleContent population={population} lang={lang} />'), content)
  },
)

Deno.test(
  'planPopulationPage(..., false): ExampleContent never receives/declares a lang prop at all — ' +
    'there is no lang to pass without /[lang]/ routing',
  async () => {
    const content = await planPopulationPage('routes', undefined, undefined, false).files[0]
      .content()

    assert(
      content.includes(
        'function ExampleContent({ population }: { population?: string }) {',
      ),
      content,
    )
    assert(content.includes('<ExampleContent population={population} />'), content)
  },
)

// ================================================================================================
// Page content — shared between both withLang states: real formatMessage() calls proving the
// wiring works (not just describing it), and a population-override query-string link.
// ================================================================================================

Deno.test(
  'planPopulationPage\'s root <main> carries the SAME data-space="content" hook ' +
    "welcomePageTemplate's own root does (space-welcome.ts) — one shared, generic value every " +
    "CLI-scaffolded template's root element uses, never a per-template one, so any --theme's " +
    'starter CSS needs only one selector to style either page',
  async () => {
    for (const withLang of [false, true]) {
      // deno-lint-ignore no-await-in-loop
      const content = await planPopulationPage('routes', undefined, undefined, withLang).files[0]
        .content()

      assert(content.includes("<main data-space='content'>"), content)
    }
  },
)

Deno.test(
  'planPopulationPage: both withLang states render real formatMessage() calls and a ' +
    '?population=<demo> override link',
  async () => {
    for (const withLang of [false, true]) {
      // deno-lint-ignore no-await-in-loop
      const content = await planPopulationPage('routes', undefined, undefined, withLang).files[0]
        .content()

      assert(content.includes("formatMessage('population/greeting')"), content)
      assert(content.includes("formatMessage('population/visitorCount'"), content)
      assert(content.includes("formatMessage('population/overrideHint'"), content)
      assert(content.includes(`?population=${POPULATION_DEMO_NAME}`), content)
      assert(content.includes('loadMessages('), content)
    }
  },
)

// ================================================================================================
// Renderer branching — reuses getSpaceUiEntry/getIntlMessagesTypeName (lib/renderer.ts), same
// mechanism space-welcome.ts/space-icons.ts already use.
// ================================================================================================

Deno.test(
  'planPopulationPage: renderer omitted, or explicitly react, imports from the React ' +
    "@zanix/space-ui entrypoint and types messages as 'Messages'",
  async () => {
    for (const renderer of [undefined, 'react' as const]) {
      // deno-lint-ignore no-await-in-loop
      const content = await planPopulationPage('routes', undefined, renderer, false).files[0]
        .content()

      assert(content.includes("from '@zanix/space-ui'"), content)
      assert(content.includes('Messages'), content)
      assertFalse(content.includes('@zanix/space-ui/preact'), content)
      assertFalse(content.includes('IntlMessages'), content)
    }
  },
)

Deno.test(
  "planPopulationPage: renderer 'preact' imports from '@zanix/space-ui/preact' and types " +
    "messages as 'IntlMessages' instead",
  async () => {
    const content = await planPopulationPage('routes', undefined, 'preact', true).files[0]
      .content()

    assert(content.includes("from '@zanix/space-ui/preact'"), content)
    assert(content.includes('IntlMessages'), content)
    assertFalse(content.includes("from '@zanix/space-ui'\n"), content)
  },
)

// ================================================================================================
// getSpaceRecipes()/getSpaceSrcTree — proves the recipe is actually wired, not just the standalone
// planner existing in isolation (mirrors space-welcome.test.ts's own recipe-wiring checks).
// ================================================================================================

Deno.test(
  "getSpaceSrcTree(root, 'population') writes routes/page.tsx via the population planner",
  () => {
    const tree = getSpaceSrcTree('space-population-recipe-test', 'population')
    const routeFiles = tree.subfolders.routes.templates.base
    assertEquals(routeFiles.map((f) => f.NAME), ['page.tsx'])
    assertEquals(routeFiles[0].PATH.endsWith('/routes/page.tsx'), true)
  },
)

Deno.test(
  "getSpaceSrcTree(root, 'population-lang') writes routes/[lang]/page.tsx instead",
  () => {
    const tree = getSpaceSrcTree('space-population-lang-recipe-test', 'population-lang')
    const routeFiles = tree.subfolders.routes.templates.base
    assertEquals(routeFiles.map((f) => f.NAME), ['page.tsx'])
    assertEquals(routeFiles[0].PATH.endsWith('/routes/[lang]/page.tsx'), true)
  },
)

Deno.test(
  "getSpaceSrcTree(root, 'population'/'population-lang') still seed the same example Comet as " +
    "'base' — Comet content is theme-owned, not template-owned",
  () => {
    for (const preset of ['population', 'population-lang']) {
      const tree = getSpaceSrcTree(`space-population-comet-test-${preset}`, preset)
      const cometFiles = tree.subfolders.comets.templates.base
      assertEquals(cometFiles.map((f) => f.NAME), ['example.comet.tsx'])
    }
  },
)

Deno.test(
  "getSpaceRecipes().population/'population-lang' resolve to distinct arrays from each other and " +
    'from welcome/base',
  () => {
    const recipes = getSpaceRecipes()
    assert(recipes.population !== recipes['population-lang'])
    assert(recipes.population !== recipes.welcome)
    assert(recipes.population !== recipes.base)
  },
)

// ================================================================================================
// applyPopulationScaffold — the disk-write half: messages/ catalog tree, routes/layout.tsx,
// src/space/middleware.ts. Plain Deno.mkdir/writeTextFile, no network — fully unit-testable.
// ================================================================================================

Deno.test(
  'applyPopulationScaffold(root, iconsReady, false): writes messages/default/index.json (base ' +
    `catalog, under the implicit-lang folder) and messages/default/populations/` +
    `${POPULATION_DEMO_NAME}.json (override), both flat`,
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, false, false)

      const base = JSON.parse(
        await Deno.readTextFile(join(root, 'messages', 'default', 'index.json')),
      )
      assert(typeof base['population/greeting'] === 'string')
      assert(typeof base['population/visitorCount'] === 'string')
      assert(typeof base['population/overrideHint'] === 'string')
      for (const value of Object.values(base)) assert(typeof value === 'string')

      const override = JSON.parse(
        await Deno.readTextFile(
          join(root, 'messages', 'default', 'populations', `${POPULATION_DEMO_NAME}.json`),
        ),
      )
      assertEquals(Object.keys(override), ['population/greeting'])
      assert(override['population/greeting'] !== base['population/greeting'])
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'applyPopulationScaffold(root, iconsReady, true): writes messages/{en,es}/index.json (base ' +
    `catalog) and messages/{en,es}/populations/${POPULATION_DEMO_NAME}.json (override), both flat`,
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, false, true)

      for (const lang of ['en', 'es']) {
        const base = JSON.parse(
          // deno-lint-ignore no-await-in-loop
          await Deno.readTextFile(join(root, 'messages', lang, 'index.json')),
        )
        assert(typeof base['population/greeting'] === 'string')
        assert(typeof base['population/visitorCount'] === 'string')
        assert(typeof base['population/overrideHint'] === 'string')
        for (const value of Object.values(base)) assert(typeof value === 'string')

        const override = JSON.parse(
          // deno-lint-ignore no-await-in-loop
          await Deno.readTextFile(
            join(root, 'messages', lang, 'populations', `${POPULATION_DEMO_NAME}.json`),
          ),
        )
        assertEquals(Object.keys(override), ['population/greeting'])
        assert(override['population/greeting'] !== base['population/greeting'])
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// ================================================================================================
// Real, confirmed regression: `population/overrideHint`'s catalog text once contained a literal
// `{lang}`, which ICU parses as a REQUIRED argument — but the page's own `formatMessage(id, {
// name })` call never passes one, so `@formatjs/intl` threw `FORMAT_ERROR` at render time (`zanix
// space dev`), not at generation time. Parsing every base-catalog message and checking its argument
// set against exactly what `populationPageTemplate`'s own `formatMessage` calls pass is the one
// check that actually catches this class of bug before a live render does.
// ================================================================================================

Deno.test(
  "applyPopulationScaffold: every base-catalog message's ICU argument set is exactly what the " +
    'generated page actually passes via formatMessage — never a stray {lang} (or any other) ' +
    'placeholder the page never supplies a value for',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, false, true)

      for (const lang of ['en', 'es']) {
        const base = JSON.parse(
          // deno-lint-ignore no-await-in-loop
          await Deno.readTextFile(join(root, 'messages', lang, 'index.json')),
        )

        assertEquals(collectArgNames(parse(base['population/greeting'])), new Set())
        assertEquals(collectArgNames(parse(base['population/visitorCount'])), new Set(['count']))
        assertEquals(collectArgNames(parse(base['population/overrideHint'])), new Set(['name']))
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'applyPopulationScaffold(root, false, withLang): writes routes/layout.tsx with no ' +
    'CatalogIcon import when iconsReady is false',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, false, false)
      const layout = await Deno.readTextFile(join(root, 'src/space/routes/layout.tsx'))
      assertFalse(layout.includes('CatalogIcon'), layout)
      assert(layout.includes("<html lang={'en'}>"), layout)
      // Exact signature line — a real regression once produced a double-braced destructure
      // (`RootLayout({ { children } }: LayoutProps)`), a syntax error Deno's parser rejects outright.
      assert(
        layout.includes('export default function RootLayout({ children }: LayoutProps) {'),
        layout,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'applyPopulationScaffold(root, true, true): includes CatalogIcon and reads lang from params ' +
    'when iconsReady and withLang are both true',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, true, true)
      const layout = await Deno.readTextFile(join(root, 'src/space/routes/layout.tsx'))
      assert(layout.includes("import { CatalogIcon } from '../catalog-icon.ts'"), layout)
      assert(layout.includes('<CatalogIcon'), layout)
      assert(layout.includes('lang={params.lang}'), layout)
      // Real, confirmed regression: LayoutProps<TChildren, TData>'s own first type parameter types
      // `children`, not `params` — `LayoutProps<{ lang: string }>` silently broke `{children}`'s
      // own type. Must always stay plain, unparameterized `LayoutProps`, even when withLang reads
      // `params.lang`.
      assert(
        layout.includes(
          'export default function RootLayout({ children, params }: LayoutProps) {',
        ),
        layout,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'applyPopulationScaffold(root, iconsReady, false): writes src/space/middleware.ts with ' +
    'populationGuard() only, no lang wiring',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, false, false)
      const middleware = await Deno.readTextFile(join(root, 'src/space/middleware.ts'))
      assert(middleware.includes('populationGuard()'), middleware)
      assertFalse(middleware.includes('langGuard'), middleware)
      assertFalse(middleware.includes('langPreHandler'), middleware)
      assertFalse(middleware.includes('definePreHandler'), middleware)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'applyPopulationScaffold(root, iconsReady, true): writes src/space/middleware.ts registering ' +
    'langGuard()+populationGuard(), plus definePreHandler(langPreHandler(...))',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    try {
      await applyPopulationScaffold(root, false, true)
      const middleware = await Deno.readTextFile(join(root, 'src/space/middleware.ts'))
      assert(middleware.includes('defineMiddleware([langGuard(), populationGuard()])'), middleware)
      assert(
        middleware.includes(
          "definePreHandler(langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }))",
        ),
        middleware,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
