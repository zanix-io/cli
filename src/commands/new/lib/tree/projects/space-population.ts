import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import {
  getIntlMessagesTypeName,
  getSpaceUiEntry,
  type RendererName,
} from 'commands/new/lib/renderer.ts'
import { join } from '@std/path'

/**
 * `--template population`/`--template population-lang` — a real, working i18n/population reference,
 * built from `zanix-react`/`zanix-preact` (two hand-wired projects that only worked correctly once
 * `middleware.ts`, `space.app.ts`'s `defineBootstrapSpaceAppConfig`, and `messagesDir` were ALL wired
 * exactly right — real friction this template exists to remove).
 *
 * Two known, mutually-exclusive values, never composable `--use-lang`/`--use-population` flags —
 * that composition was deliberately descoped earlier: i18n's own URL structure/guard ordering is a
 * real architectural commitment, not something safely sprinkled onto every other preset/flag
 * combination. `populationGuard` and `langPreHandler`/`langGuard` are genuinely independent
 * mechanisms (`populationGuard` resolves from route param → query string → cookie, no dependency on
 * any `/[lang]/...` URL at all), so this file's own `withLang` boolean is the ONE thing that
 * separates the two values — everything else (page tutorial content, messages catalog, layout
 * shell) is shared, never duplicated:
 * - `'population'` (`withLang: false`) — `populationGuard()` only, a single implicit locale (its
 *   catalog folder named `IMPLICIT_LANG`, `'default'`, never a real language code like `'en'` —
 *   see that constant's own doc), no `/[lang]/` prefix, no `langPreHandler`/`langGuard`. For an app
 *   that wants content variants (tenant/segment) without URL-based i18n.
 * - `'population-lang'` (`withLang: true`) — everything `'population'` has, PLUS
 *   `langPreHandler`/`langGuard` and real `/[lang]/...` routing — the full reference-project shape.
 *
 * The generated page is deliberately NOT a port of `--template welcome`'s own landing-page copy
 * (Comets/differentiators/space-ui blurb belong to that preset, not this one) — it's a working
 * TUTORIAL for the mechanism itself: the resolved `lang`/`population` for the CURRENT request,
 * displayed via real `formatMessage()` calls (so `?population=beta` visibly changes the page, proof
 * the wiring works, not just a description of it), a real ICU-pluralized message key next to the
 * `formatMessage(id, values)` call that reads it, and a pointer to `messages/{lang}/populations/`
 * for the override mechanism this same file writes a working example of.
 *
 * `getSpaceUiEntry`/`getHooksEntry` (`lib/renderer.ts`) are reused exactly as `space-welcome.ts`/
 * `space-icons.ts`/`space-astronaut.ts` already do — no new renderer-branching logic invented. One
 * new small helper lives alongside them, `getIntlMessagesTypeName`, for a real naming asymmetry in
 * `@zanix/space-ui` itself (`Messages` vs `IntlMessages` across its two entry points).
 *
 * @module
 */

/** One file this preset writes — same shape as `WelcomePagePlanFile` (`space-welcome.ts`). */
export interface PopulationPagePlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface PopulationPagePlan {
  files: PopulationPagePlanFile[]
}

/** The demo population variant name this template's own generated `messages/<lang>/populations/`
 * override targets — a generic placeholder (`beta`), not `zanix`: the reference projects' own
 * choice made sense for THEIR testing against this monorepo, not for every generated project. */
export const POPULATION_DEMO_NAME = 'beta'

/** The catalog folder name `--template population` (`!withLang`, no `[lang]` routing at all) uses
 * for its one implicit locale — never a real language code like `'en'`, which would falsely imply
 * the catalog is specifically English rather than "whatever this app's only content variant
 * happens to be." Mirrors `@zanix/space`'s own `DEFAULT_IMPLICIT_LANG` (`messages-registry.ts`) —
 * same value, kept as its own literal here rather than an actual import: this generator writes
 * source for OTHER projects, it has no runtime dependency on `@zanix/space` itself to answer a
 * string-constant question. `--template population-lang` (`withLang: true`) never uses this at
 * all — it has real `en`/`es` locales with real routing, not an implicit placeholder. */
const IMPLICIT_LANG = 'default'

/** The two message keys `messages/<lang>/populations/<name>.json` overrides one of, and the page's
 * own tutorial text points at — kept as real constants (not re-typed at each call site) so the
 * page template, the base catalog, and the override catalog can never drift apart. */
const GREETING_KEY = 'population/greeting'
const VISITOR_COUNT_KEY = 'population/visitorCount'
const OVERRIDE_HINT_KEY = 'population/overrideHint'

/**
 * `routes/page.tsx` (`!withLang`) or `routes/[lang]/page.tsx` (`withLang`) — a real
 * `@Page()`/`SpacePageController` component (the same real, current `@zanix/space` contract
 * `welcomePageTemplate`/`pageTemplate` already follow), whose `loader` calls `loadMessages(...)` and
 * whose `component` renders through `<IntlProvider>`/`useIntl()` — never a hardcoded-English page
 * with i18n bolted on after the fact.
 */
function populationPageTemplate(
  renderer: RendererName | undefined,
  withLang: boolean,
): string {
  const spaceUiEntry = getSpaceUiEntry(renderer)
  const messagesType = getIntlMessagesTypeName(renderer)

  const loaderCtxType = withLang ? `PageContext<{ lang: string }>` : 'PageContext'
  const loaderLangLine = withLang
    ? `  const lang = ctx.params.lang\n`
    : `  const lang = '${IMPLICIT_LANG}'\n`
  const loaderBody =
    `${loaderLangLine}  const messages = await loadMessages({ lang, population: ctx.population }) as ${messagesType}\n` +
    `  return { lang, messages, population: ctx.population }`

  const currentLangLine = withLang
    ? `      <p>Current language: <strong>{lang}</strong> — try <code>/es</code> for the other one.</p>\n`
    : ''
  const classDecl = withLang
    ? `class ExamplePage extends SpacePageController<{ lang: string }>`
    : `class ExamplePage extends SpacePageController`
  const contentPropsType = withLang
    ? '{ lang: string; population?: string }'
    : '{ population?: string }'
  const contentDestructure = withLang ? '{ lang, population }' : '{ population }'
  const contentLangProp = withLang ? ' lang={lang}' : ''
  // `withLang`'s own catalogs are real `en`/`es` locales; `!withLang` has exactly one implicit
  // catalog, named `IMPLICIT_LANG` (`'default'`), never `'en'` — see that constant's own doc.
  const messagesLangFolder = withLang ? 'en' : IMPLICIT_LANG

  return `import { loadMessages, Page, SpacePageController } from '@zanix/space'
import type { PageContext } from '@zanix/space'
import { IntlProvider, Link, useIntl } from '${spaceUiEntry}'
import type { ${messagesType} } from '${spaceUiEntry}'

type ExampleViewProps = {
  lang: string
  messages: ${messagesType}
  population?: string
}

// Shown as literal source below, never re-parsed — the exact ICU string
// \`messages/${messagesLangFolder}/index.json\` has for {@linkcode VISITOR_COUNT_KEY} (kept here,
// not restated by hand, so the two can never drift apart silently).
const visitorCountSource =
  '"${VISITOR_COUNT_KEY}": "{count, plural, one {# visitor} other {# visitors}} today."'

function ExampleContent(${contentDestructure}: ${contentPropsType}) {
  const { formatMessage } = useIntl()

  return (
    <>
      <p>{formatMessage('${GREETING_KEY}')}</p>
      <p>{formatMessage('${VISITOR_COUNT_KEY}', { count: population ? 42 : 1 })}</p>
${currentLangLine}      <p>Current population: <strong>{population ?? 'default'}</strong> — try{' '}
        <Link href={\`?population=${POPULATION_DEMO_NAME}\`}>?population=${POPULATION_DEMO_NAME}</Link>{' '}
        to see the override below take effect.
      </p>

      <h2>How to add a message</h2>
      <p>
        Catalogs are plain, human-authored JSON (
        <code>messages/${messagesLangFolder}/index.json</code>) — real ICU
        syntax, never pre-compiled by hand: <code>zanix space build</code> compiles them to AST for
        production, the file on disk stays exactly this readable. The pluralized line above reads:
      </p>
      <pre>{visitorCountSource}</pre>

      <h2>How population overrides work</h2>
      <p>
        {formatMessage('${OVERRIDE_HINT_KEY}', { name: '${POPULATION_DEMO_NAME}' })}
      </p>

      <h2>What's actually running this request</h2>
      <p>
        <code>src/space/middleware.ts</code> registers${
    withLang ? ' <code>langGuard()</code> and' : ''
  } <code>populationGuard()</code>
        ${
    withLang
      ? "as global guards, plus definePreHandler(langPreHandler(...)) for the '/[lang]/...' redirect"
      : 'as a global guard'
  } — start there to change any of this. See{' '}
        <Link href='https://github.com/zanix-io/space/blob/master/docs/i18n.md' external>
          docs/i18n.md
        </Link>{' '}
        and{' '}
        <Link href='https://github.com/zanix-io/space/blob/master/docs/middleware.md' external>
          docs/middleware.md
        </Link>{' '}
        for the full mechanism.
      </p>
    </>
  )
}

function ExampleView({ lang, messages, population }: ExampleViewProps) {
  return (
    <main data-space='content'>
      <h1>i18n and population, wired and working</h1>
      <IntlProvider locale={lang} messages={messages}>
        <ExampleContent population={population}${contentLangProp} />
      </IntlProvider>
    </main>
  )
}

@Page()
export default ${classDecl} {
  public static override head = { title: 'i18n and population' }

  public override loader = async (ctx: ${loaderCtxType}) => {
${loaderBody}
  }

  public override component = ExampleView
}
`
}

/**
 * Pure planning for the `'population'`/`'population-lang'` presets' own root route — same
 * `plan<Name>(folder)` shape every `ScaffoldRecipeEntry['plan']` expects (`recipe.ts`), writing to
 * `${pageFolder}/page.tsx` (matching `'base'`'s own path) when `!withLang`, or
 * `${pageFolder}/[lang]/page.tsx` when `withLang` — both presets REPLACE what goes in the page slot,
 * neither adds a second page. `theme` is accepted for signature symmetry with `planWelcomePage`
 * (`getSpaceRecipes`'s own recipe-entry shape threads it to every preset's `plan` call uniformly)
 * but unused here — this preset's own content is identical regardless of `--theme`, unlike
 * `welcome`'s.
 */
export function planPopulationPage(
  pageFolder: string,
  _theme: ThemeName | undefined,
  renderer: RendererName | undefined,
  withLang: boolean,
): PopulationPagePlan {
  const path = withLang ? `${pageFolder}/[lang]/page.tsx` : `${pageFolder}/page.tsx`
  return {
    files: [{
      PATH: path,
      NAME: 'page.tsx',
      content: () => Promise.resolve(populationPageTemplate(renderer, withLang)),
    }],
  }
}

/**
 * `src/space/middleware.ts` — byte-identical across renderers (confirmed via diff against both
 * `zanix-react`/`zanix-preact`; neither `defineMiddleware`/`definePreHandler`/the guards themselves
 * import anything renderer-specific), so this template takes no `renderer` parameter at all, only
 * `withLang`.
 */
function middlewareTemplate(withLang: boolean): string {
  if (!withLang) {
    return `import { defineMiddleware, populationGuard } from '@zanix/space'

// Purely additive — never rejects a request, safe to apply app-wide. Resolves \`ctx.population\`
// from route param -> query string -> cookie, exposed to every page's own \`loader\`.
export default defineMiddleware([populationGuard()])
`
  }

  return `import {
  defineMiddleware,
  definePreHandler,
  langGuard,
  langPreHandler,
  populationGuard,
} from '@zanix/space'

// Registers both as global guards (module-level side effect via \`defineMiddleware\`). \`langGuard\`
// refreshes the \`X-Znx-Lang\` cookie for requests that are already correctly prefixed (e.g. a
// language-switcher link), which \`langPreHandler\` alone can't do since it only ever redirects or
// falls through. \`populationGuard\` resolves \`ctx.population\` (route param -> query string ->
// cookie) server-side, exposed to every page's own \`loader\`.
export default defineMiddleware([langGuard(), populationGuard()])

// \`definePreHandler\` (not a literal \`preHandler:\` passed only to \`mod.ts\`'s own bootstrap call)
// is what makes this actually run under \`zanix space dev\` too, not just production — \`zanix space
// dev\` only ever imports \`space.app.ts\` (never \`mod.ts\`), so a \`preHandler\` declared solely in
// \`mod.ts\` would be invisible to it. This file is imported from \`space.app.ts\` for the same
// reason.
definePreHandler(langPreHandler({ availableLangs: ['en', 'es'], defaultLang: 'en' }))
`
}

/**
 * `routes/layout.tsx` — the root document shell (`<html>`/`<head>`), always at `routes/layout.tsx`
 * regardless of `withLang`: `LayoutProps.params.lang` is populated from the matched CHILD route
 * segment even though this file itself sits one level above `[lang]/` (confirmed against the
 * reference projects — `Space`'s own routing threads a matched route's params up to shared
 * layouts). `!withLang` has no `[lang]` segment to read a param from at all, so `lang='en'` is
 * hardcoded instead.
 *
 * Always plain `LayoutProps`, NEVER `LayoutProps<{ lang: string }>` — a real, confirmed mistake
 * this template once made: `LayoutProps<TChildren, TData>`'s own first type parameter is what
 * `children` is typed as, not `params` (`params` is always `Record<string, string>`, never
 * narrowable per layout — see `LayoutProps`'s own doc in `@zanix/space`). Passing `{ lang: string }`
 * there silently retyped `children` itself, breaking `{children}` in the `<body>` below. `PageContext`
 * (`populationPageTemplate`, above) and `SpacePageController` are different types with their OWN
 * first type parameter genuinely being `Params` — this mistake doesn't generalize to them.
 *
 * Includes `<CatalogIcon name='spinner' />` ONLY when `icons` is true — `--icons` is a genuinely
 * independent, opt-in flag (see `space-icons.ts`'s own doc), so this template must never assume the
 * `src/space/catalog-icon.ts` wrapper it would import exists. Threaded as a plain boolean parameter,
 * same "explicit axis, never global state" convention every other template in this module already
 * follows. No `renderer` parameter needed — `catalog-icon.ts`'s own renderer-specific
 * `@zanix/space-ui` import is already resolved once, by `getCatalogIconWrapperTemplate`
 * (`space-icons.ts`) at the time THAT file was generated; this one only ever imports it by a plain,
 * renderer-agnostic relative path.
 */
function layoutTemplate(icons: boolean, withLang: boolean): string {
  const htmlLangAttr = withLang ? 'params.lang' : "'en'"
  const destructure = withLang ? '{ children, params }' : '{ children }'
  const catalogIconImport = icons ? "\nimport { CatalogIcon } from '../catalog-icon.ts'" : ''
  const catalogIconUsage = icons ? "\n      <CatalogIcon name='spinner' />" : ''

  return `import type { LayoutProps } from '@zanix/space'${catalogIconImport}

export default function RootLayout(${destructure}: LayoutProps) {
  return (
    <html lang={${htmlLangAttr}}>${catalogIconUsage}
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
`
}

/** Base catalog (`messages/{en,es}/index.json`, or `messages/${IMPLICIT_LANG}/index.json` for
 * `--template population`) — the greeting/visitor-count/override-hint keys the page's own tutorial
 * content reads via `formatMessage(...)`. Flat, as `docs/i18n.md`'s own correctness constraint
 * requires (a nested shape would silently lose sibling keys on merge).
 *
 * `folderName` (defaults to `lang`) is ONLY for the override-hint's own path reference — `lang`
 * still selects which language the CONTENT itself is written in (`withLang`'s real `en`/`es`
 * catalogs), independent of where `!withLang`'s one implicit catalog actually lives on disk
 * (`IMPLICIT_LANG`, never a literal `'en'` — see that constant's own doc). */
function baseCatalog(lang: 'en' | 'es', folderName: string = lang): Record<string, string> {
  return lang === 'es'
    ? {
      [GREETING_KEY]: 'Hola desde el catálogo por defecto.',
      [VISITOR_COUNT_KEY]: '{count, plural, one {# visitante} other {# visitantes}} hoy.',
      [OVERRIDE_HINT_KEY]:
        "Esta misma línea la sobreescribe la variante de population '{name}' — ver " +
        `messages/${folderName}/populations/{name}.json.`,
    }
    : {
      [GREETING_KEY]: 'Hello from the default catalog.',
      [VISITOR_COUNT_KEY]: '{count, plural, one {# visitor} other {# visitors}} today.',
      [OVERRIDE_HINT_KEY]:
        "This exact line is overridden by the '{name}' population variant — see " +
        `messages/${folderName}/populations/{name}.json.`,
    }
}

/** Population override catalog (`messages/{en,es}/populations/${POPULATION_DEMO_NAME}.json`) — only
 * the ONE key it actually changes, per `loadMessages`'s own shallow-merge contract (base + override,
 * never a whole-file replace) — never re-declares the others. */
function overrideCatalog(lang: 'en' | 'es'): Record<string, string> {
  return lang === 'es'
    ? { [GREETING_KEY]: `¡Hola! Estás viendo la variante de population '${POPULATION_DEMO_NAME}'.` }
    : { [GREETING_KEY]: `Hello! You're viewing the '${POPULATION_DEMO_NAME}' population variant.` }
}

/**
 * Applies every population-only side effect that isn't the recipe-driven page itself: the
 * `messages/` catalog tree, `routes/layout.tsx`, and `src/space/middleware.ts`. Called from
 * `ensureSpaceScaffoldSideEffects` (`space.ts`) — deliberately NOT threaded through
 * `getSpaceRecipes`/`getSpaceSrcTree` the way the page itself is, because `layout.tsx`'s own
 * `icons`-conditional content needs `iconsReady` (the REAL post-attempt state, not the raw `--icons`
 * flag — a requested-but-failed icon catalog must never leave `layout.tsx` importing a
 * `catalog-icon.ts` that was never actually written), which only exists at that later point in
 * `ensureSpaceScaffoldSideEffects`, after its own icons step already ran.
 *
 * Plain `Deno.mkdir`/`Deno.writeTextFile` throughout — no JSR fetch, no assets involved, same
 * directness as `space-theme.ts`'s own CSS writer. Caller wraps this in its own try/catch (same
 * graceful-degradation contract `copyIconCatalog`/`copyThemeAssets` already established) — this
 * function itself throws on a real failure rather than swallowing it.
 */
export async function applyPopulationScaffold(
  root: string,
  iconsReady: boolean,
  withLang: boolean,
): Promise<void> {
  const messagesRoot = join(root, 'messages')
  // `withLang`: real bilingual routing, one catalog per real locale. `!withLang`: exactly one
  // implicit catalog — English content (`baseCatalog('en')`), but written under `IMPLICIT_LANG`
  // (`'default'`), never a literal `'en'` folder — see that constant's own doc for why.
  const catalogLangs: readonly ('en' | 'es')[] = withLang ? ['en', 'es'] : ['en']
  for (const lang of catalogLangs) {
    const folderName = withLang ? lang : IMPLICIT_LANG
    const langDir = join(messagesRoot, folderName)
    const populationsDir = join(langDir, 'populations')
    // deno-lint-ignore no-await-in-loop
    await Deno.mkdir(populationsDir, { recursive: true })
    // deno-lint-ignore no-await-in-loop
    await Deno.writeTextFile(
      join(langDir, 'index.json'),
      JSON.stringify(baseCatalog(lang, folderName), null, 2) + '\n',
    )
    // deno-lint-ignore no-await-in-loop
    await Deno.writeTextFile(
      join(populationsDir, `${POPULATION_DEMO_NAME}.json`),
      JSON.stringify(overrideCatalog(lang), null, 2) + '\n',
    )
  }

  const routesDir = join(root, 'src/space/routes')
  await Deno.mkdir(routesDir, { recursive: true })
  await Deno.writeTextFile(
    join(routesDir, 'layout.tsx'),
    layoutTemplate(iconsReady, withLang),
  )

  const spaceDir = join(root, 'src/space')
  await Deno.mkdir(spaceDir, { recursive: true })
  await Deno.writeTextFile(join(spaceDir, 'middleware.ts'), middlewareTemplate(withLang))
}
