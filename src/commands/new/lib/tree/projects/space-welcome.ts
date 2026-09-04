import type { ThemeName } from 'commands/new/lib/tree/themes.ts'
import { getSpaceUiEntry, type RendererName } from 'commands/new/lib/renderer.ts'

/**
 * `--template welcome`'s own content — the one deliberate exception to `presets.ts`'s own "every
 * preset is composition, never new generation logic of its own" rule. Every OTHER preset only ever
 * rearranges an existing `plan<Name>` call's arguments; `'welcome'` genuinely needs a real,
 * different `page.tsx` — a landing page a freshly scaffolded `space`/`spacecraft` project shows
 * instead of the generic `Example` route `'base'` writes (the same idea as Handlebars' own default
 * welcome page for a fresh project) — so this file follows `page/command.ts`'s own `planPage`
 * shape (a `plan<Name>`-style pure planner, one `PagePlanFile`-shaped file) without calling
 * `planPage` itself, since `pageTemplate`'s own generic `<h1>${pascalName}</h1>` body isn't what
 * this preset needs to write.
 *
 * Composed from `@zanix/space-ui` — this project's own headless component library — specifically
 * `Link` (`@zanix/space-ui`'s real, published `LinkProps` contract: `href`/`external`/`children`,
 * verified directly against its own `src/components/Link/types.ts` and `index.ts`'s own
 * `@example`), never `SocialNetworks`/`CatalogIcon`: both of those require a real icon/logo
 * (`SocialNetworkIcon['href'|'viewBox']` or a raster `img`) to render anything meaningful, and this
 * preset has no icon of its own to give them — `--icons` is a genuinely independent, opt-in flag
 * (see `space-icons.ts`'s own doc: "never coupled to `--template`/the visual theme").
 *
 * Takes an optional `theme` (`themes.ts`'s own `ThemeName`, forwarded from `--theme` — see
 * `space.ts`'s own doc for exactly how the two axes compose): the page's CONTENT is the same
 * regardless of theme (every section below applies to `'welcome'` alone), but a few details adapt
 * to whether `theme === 'astronaut'` specifically:
 * - The opening paragraph mentions the astronaut theme by name only when it's actually active.
 * - `.welcome-emoji` (a decorative astronaut badge, styled entirely by `astronaut.css`) only
 *   renders under that theme — with no theme (or `'default'`, which ships no such class) it would
 *   be a bare, unstyled emoji floating with no visual treatment.
 * - The Comets section's body text describes whichever Comet content `space.ts`'s own recipe
 *   wiring actually wrote next to this page — the plain placeholder (no theme) or the interactive
 *   launch demo (`--theme astronaut`, see `space-astronaut.ts`'s own `astronautCometTemplate`) —
 *   never a mismatched description of a Comet the project doesn't actually have.
 *
 * Also takes an optional `renderer` (`--renderer`, `lib/renderer.ts`'s own `RendererName`):
 * `@zanix/space-ui`'s `Link` import resolves through {@linkcode getSpaceUiEntry} — the same shared
 * helper `space-icons.ts`'s own `getCatalogIconWrapperTemplate` and `space-astronaut.ts`'s own
 * `astronautCometTemplate` resolve their own `@zanix/space-ui` imports through, so a `--renderer
 * preact` project never ends up with a React-flavored import regardless of which template
 * generated the file.
 *
 * @module
 */

/** One file this preset writes — same shape/reasoning as `PagePlanFile` (`page/command.ts`). */
export interface WelcomePagePlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

export interface WelcomePagePlan {
  files: WelcomePagePlanFile[]
}

/**
 * `routes/page.tsx` for `--template welcome` — a real `@Page()`/`SpacePageController` component
 * (the exact same real, current `@zanix/space` contract `pageTemplate` itself follows: no-argument
 * `@Page()`, `public static override head`, `public override component`), with real welcome copy,
 * a "what makes Space different" summary, and two real outbound links.
 *
 * Both links point at this project's own real, current GitHub org (`https://github.com/zanix-io`)
 * — the same URL `cli`'s own `README.md` already cites as "Zanix Framework Documentation" (there is
 * no separate docs domain yet) — `@zanix/space`'s own repo for "Documentation", the org itself for
 * "GitHub". `external` is set on both (`Link`'s own contract: `target="_blank"` plus a safe
 * `rel="noopener noreferrer"`), matching every other outbound link in this ecosystem's own
 * generated output.
 *
 * Fixed copy, not derived from the project's own name — the same convention Vite's own default
 * templates use ("Vite + React", never the consuming project's own name) — `WelcomePage`/
 * `WelcomeView` are fixed identifiers too.
 *
 * Its root `<main>` carries a stable `data-space="content"` hook — an `@zanix/space` attribute (the
 * same convention `default-not-found-view.tsx`'s own `data-space="not-found"` establishes in that
 * package), so any `--theme` value's own `theme/space-defaults.css` can style this page. Shared
 * verbatim with `--template population`'s own root element (`space-population.ts`) — ONE generic
 * "scaffolded content page" value, not a per-template one, so a future template reuses the same
 * hook (and every `--theme`'s existing CSS for it) with zero CSS changes anywhere, only its own
 * `data-space="content"` attribute — see `space-astronaut.ts`'s own doc for the CSS side of this.
 */
export const welcomePageTemplate = (
  theme?: ThemeName,
  renderer: RendererName | undefined = undefined,
): string => {
  const isAstronaut = theme === 'astronaut'
  const spaceUiEntry = getSpaceUiEntry(renderer)

  const emoji = isAstronaut ? `      <p className='welcome-emoji' aria-hidden='true'>🧑‍🚀</p>\n` : ''
  const intro = isAstronaut
    ? `You have successfully created a new @zanix/space app, styled with an{' '}
        <strong>astronaut theme</strong> (<code>theme/</code>, wired through{' '}
        <code>space.app.ts</code>'s own <code>globalCss</code>). Edit{' '}
        <code>src/space/routes/page.tsx</code> to get started.`
    : `You have successfully created a new @zanix/space app. Edit{' '}
        <code>src/space/routes/page.tsx</code> to get started.`
  const cometsBody = isAstronaut
    ? `The demo below is a <strong>Comet</strong>{' '}
        (<code>src/space/comets/example.comet.tsx</code>): server-rendered like the rest of this
        page, but hydrated on its own, independently of everything around it. Click the button — it
        launches a real comet across your screen.`
    : `The demo below is a <strong>Comet</strong>{' '}
        (<code>src/space/comets/example.comet.tsx</code>): server-rendered like the rest of this
        page, but hydrated on its own, independently of everything around it — a starting point for
        your own interactive pieces, not a working demo on its own yet.`
  const spaceUiBody = isAstronaut
    ? `The button above and the links below both come from{' '}
        <code>@zanix/space-ui</code>: accessible, unstyled primitives (real keyboard/ARIA semantics,
        zero shipped CSS) that only render a stable <code>data-space-ui="..."</code>{' '}
        hook. Every visual you see — dark background, amber accent, hover color — comes entirely
        from this project's own <code>theme/</code> files, not from the library.`
    : `The links below come from <code>@zanix/space-ui</code>: accessible, unstyled primitives
        (real keyboard/ARIA semantics, zero shipped CSS) that only render a stable{' '}
        <code>data-space-ui="..."</code> hook. Add a <code>--theme</code> to this project (or your
        own <code>theme/</code> stylesheets) to give them a real visual identity.`

  return `import { Page, SpacePageController } from '@zanix/space'
import { Link } from '${spaceUiEntry}'
import ExampleCounter from '../comets/example.comet.tsx'

function WelcomeView() {
  return (
    <main data-space='content'>
${emoji}      <h1>Welcome to your Zanix Space project</h1>
      <p>
        ${intro}
      </p>

      <h2>Comets — selective hydration</h2>
      <p>
        ${cometsBody}
      </p>
      <ExampleCounter />

      <h2>What makes Space different</h2>
      <ul>
        <li>
          <strong>Deno-native</strong>{' '}
          — no Node runtime, no CommonJS, no polyfills; built directly on <code>Deno.serve()</code>
          {' '}
          and Web Streams.
        </li>
        <li>
          <strong>Streaming SSR</strong> — React's <code>renderToReadableStream</code>{' '}
          end to end, with one predictable serialized state block instead of scattered globals.
        </li>
        <li>
          <strong>Comets</strong>{' '}
          — selective hydration, demonstrated above: only the interactive pieces of a page ship
          client JS, everything else stays server-rendered markup.
        </li>
        <li>
          <strong>Orbit</strong>{' '}
          — client-side navigation is on by default (<code>initOrbit()</code>, auto-wired):
          same-origin links swap just the page outlet instead of a full reload, with hover/focus
          prefetch, and still work as real <code>&lt;a href&gt;</code> tags if JS never loads.
        </li>
        <li>
          <strong>Secure by default</strong> — every page gets a nonce-based{' '}
          <code>Content-Security-Policy</code>{' '}
          and security headers automatically; nothing here (this very page included) relies on{' '}
          <code>'unsafe-inline'</code>.
        </li>
        <li>
          <strong>One Zanix App model</strong>{' '}
          — this frontend composes into the same manifest/activation model a{' '}
          <code>@zanix/server</code>{' '}
          backend already uses; no separate deployment mechanism of its own.
        </li>
      </ul>

      <h2>@zanix/space-ui — headless components</h2>
      <p>
        ${spaceUiBody}
      </p>

      <h2>Multiple languages and content variants</h2>
      <p>
        This page's own copy is fixed, but a real app rarely is: <code>@zanix/space</code>{' '}
        ships <code>langPreHandler</code>/<code>langGuard</code> for URL-prefixed locales
        (<code>/en</code>, <code>/es</code>, ...) and <code>populationGuard</code> for
        per-tenant/per-segment content variants, both resolved server-side before your page ever
        renders. Neither is wired into this scaffold by default — they're a real architectural
        commitment (URL structure, guard placement), not a flag to bolt on later — so start from
        the real, current guide instead of guessing at the wiring.
      </p>
      <p>
        <Link
          href='https://github.com/zanix-io/space/blob/master/docs/i18n.md'
          external
        >
          i18n and population guide
        </Link>
      </p>

      <h2>Learn more</h2>
      <p>
        <Link href='https://github.com/zanix-io/space' external>Documentation</Link>
        {' · '}
        <Link href='https://github.com/zanix-io' external>GitHub</Link>
      </p>
    </main>
  )
}

@Page()
export default class WelcomePage extends SpacePageController {
  public static override head = { title: 'Welcome to Zanix Space' }

  public override component = WelcomeView
}
`
}

/**
 * Pure planning for the `'welcome'` preset's own root route — same `plan<Name>(folder)` shape
 * every `ScaffoldRecipeEntry['plan']` expects (`recipe.ts`), writing to the exact same
 * `${pageFolder}/page.tsx` path `planPage('Example', folder)` would for `'base'` — this preset
 * REPLACES what goes in that one file, it doesn't add a second page.
 */
export function planWelcomePage(
  pageFolder: string,
  theme?: ThemeName,
  renderer: RendererName | undefined = undefined,
): WelcomePagePlan {
  return {
    files: [{
      PATH: `${pageFolder}/page.tsx`,
      NAME: 'page.tsx',
      content: () => Promise.resolve(welcomePageTemplate(theme, renderer)),
    }],
  }
}
