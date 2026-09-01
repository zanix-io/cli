import type { CometPlan, CometPlanFile } from 'commands/generate/comet/command.ts'

import {
  getSpaceUiThemeTemplate,
  THEME_TEMPLATE_FILES,
} from 'commands/new/lib/tree/projects/space-theme.ts'
import { getHooksEntry, getSpaceUiEntry, type RendererName } from 'commands/new/lib/renderer.ts'
import { join } from '@std/path'

/**
 * `--theme astronaut`'s own content (`themes.ts`) — a complete, dark "deep space" visual identity,
 * independent of `--template`: the theme CSS below, plus the one Comet demo `space.ts`'s own
 * recipe wiring selects whenever `theme === 'astronaut'`, regardless of which `--template` value a
 * project also requested (see `themes.ts`'s own doc for why Comet content is theme-owned, not
 * template-owned).
 *
 * Shares the exact same two theme-agnostic files `--theme default` already fetches from
 * `@zanix/space-ui` ({@linkcode THEME_TEMPLATE_FILES}'s `behavior.css`/`card.css` entries, via
 * {@linkcode getSpaceUiThemeTemplate} — reused unchanged, not re-implemented) — this theme differs
 * from `'default'` only in its palette (`tokens.css`), its `space-defaults.css` (a wider
 * `max-width`, for `--template welcome`'s longer copy), and one wholly new file (`astronaut.css`,
 * decorative stars/rocket/comet CSS with no `@zanix/space-ui` equivalent), all three embedded here
 * as string constants — same "embedded, not fetched" precedent `space-theme.ts`'s own
 * `LOCAL_SPACE_DEFAULTS_CSS` already establishes, for the same reason: content with no published
 * upstream source to fetch from.
 *
 * The Comet demo reuses `generate/comet/command.ts`'s own `CometPlan`/`CometPlanFile` types (never
 * redeclared here) — this module only supplies different CONTENT for that same shape, exactly the
 * same "own `plan<Name>`, different body" pattern `space-welcome.ts`'s own `planWelcomePage`
 * already established for `'welcome'`.
 *
 * @module
 */

// -------------------------------------------------------------------------------------------
// Theme (theme/*.css)
// -------------------------------------------------------------------------------------------

/** The two theme-agnostic files this theme shares byte-for-byte with `--theme default` — only
 * `tokens.css` differs between the two (a different palette, same semantic names), so this filters
 * it out of {@linkcode THEME_TEMPLATE_FILES} rather than re-declaring `behavior.css`/`card.css`'s
 * own `source`/`target` pairs a second time. */
const SHARED_THEME_FILES = THEME_TEMPLATE_FILES.filter(({ target }) => target !== 'tokens.css')

export const ASTRONAUT_TOKENS_TARGET = 'tokens.css'
export const ASTRONAUT_SPACE_DEFAULTS_TARGET = 'space-defaults.css'
export const ASTRONAUT_DECORATIONS_TARGET = 'astronaut.css'

/**
 * A dark "deep space" palette — built on the exact same two-level structure (primitives, then
 * semantics referencing them) `--theme default`'s own generic `tokens.css` uses. Every SEMANTIC
 * name (`--space-color-*`) matches that generic file exactly, so the shared `behavior.css`/
 * `card.css` (unmodified) and {@linkcode LOCAL_ASTRONAUT_SPACE_DEFAULTS_CSS} keep working unchanged
 * regardless of which of the two palettes a project ends up with.
 */
export const LOCAL_ASTRONAUT_TOKENS_CSS = `/*
 * Astronaut theme — starter tokens
 * ---------------------------------
 * Scaffolded by \`zanix new space --theme astronaut\` as a plain file the new project owns
 * outright: no import, no version pin, edit/extend/delete freely. Not imported by any
 * \`@zanix/space-ui\` runtime code — nothing in that package breaks if this file never existed.
 *
 * Two levels, exactly as \`@zanix/space\`'s own \`docs/theming.md\` documents:
 *   - primitives: raw scale values, never referenced directly by a component or by
 *     \`./behavior.css\` — implementation detail of this palette only.
 *   - semantics:  named roles that reference a primitive — the only level anything else may
 *     consume (a component, or a host app overriding this file's cascade).
 *
 * Every custom property is prefixed \`--space-*\`, per the same convention — never a bare name,
 * never a name colliding with a third-party prefix (e.g. Tailwind's \`--tw-*\`).
 *
 * A host app overrides any of these by redeclaring the SEMANTIC name in its own stylesheet loaded
 * after this one — the normal \`globalCss\` cascade \`docs/theming.md\` already documents, no special
 * mechanism. It never needs to know these primitives exist.
 */

:root {
  /* ---- primitives ---- */
  --space-navy-950: #05060a; /* deep space background */
  --space-navy-900: #0d1321; /* card/surface, one step up from the void */
  --space-navy-700: #1b2540; /* border — a subtle seam, never a hard line against the dark */
  --space-silver-100: #f1f5f9; /* starlight — primary text */
  --space-silver-400: #94a3b8; /* muted text — a dimmer star */
  --space-amber-400: #fbbf24; /* visor reflection / mission-patch accent */
  --space-amber-500: #f59e0b; /* the same accent, one shade deeper, for hover/active */
  --space-black: #000000;

  /* ---- semantics — the only level a component or \`./behavior.css\` may reference ---- */
  --space-color-primary: var(--space-amber-400);
  --space-color-primary-strong: var(--space-amber-500);
  --space-color-surface: var(--space-navy-950);
  --space-color-border: var(--space-navy-700);
  --space-color-ink: var(--space-silver-100);
  --space-color-ink-muted: var(--space-silver-400);

  /* One-off constants, not a multi-step scale — no primitive layer to derive them from, so they're
     declared directly as semantics. Consumed by \`./behavior.css\`'s \`.space-ui-overlay\`-style hooks. */
  --space-color-scrim: color-mix(in srgb, var(--space-black) 50%, transparent);
  --space-z-overlay: 2147483646;
}
`

/**
 * `space-defaults.css`'s astronaut variant — same `[data-space="not-found"|"error"|"content"]`
 * hooks as `--theme default`'s own `LOCAL_SPACE_DEFAULTS_CSS` (`space-theme.ts`), only the
 * `content` selector's `max-width` differs (56.25rem instead of 32rem, to fit `--template
 * welcome`'s longer, multi-section landing page — `population`'s own tutorial content shares that
 * wider column too, since it also runs multiple `<h2>` sections). A separate, dedicated constant
 * rather than a parameterized shared one — the two files serve genuinely different preset content
 * (a one-paragraph landing page vs. a multi-section one), so their layout constraints are expected
 * to diverge further over time, not converge.
 *
 * `data-space="content"` is the ONE shared root-element hook every real, CLI-scaffolded page uses
 * (`welcome`, `population` — see `space-welcome.ts`'s own doc for why this is a single generic
 * value, not one per `--template`) — distinct from `@zanix/space`'s own framework-owned
 * `"not-found"`/`"error"` built-ins. See {@linkcode LOCAL_ASTRONAUT_DECORATIONS_CSS} below for the
 * larger, decorative counterpart of this same file.
 */
export const LOCAL_ASTRONAUT_SPACE_DEFAULTS_CSS = `/*
 * Astronaut theme — @zanix/space built-in view styling
 * -------------------------------------------------------------
 * Scaffolded by \`zanix new space --theme astronaut\`, alongside \`./tokens.css\`,
 * \`./astronaut.css\`, and \`./{behavior,card}.css\` — a plain file the new project owns outright: no
 * import, no version pin, edit/extend/delete freely. Not imported by any \`@zanix/space-ui\` runtime
 * code, and not imported by \`@zanix/space\` either — nothing in either package breaks if this file
 * never existed.
 *
 * Deliberately separate from \`./behavior.css\`: that file is scoped to \`@zanix/space-ui\`'s OWN
 * \`[data-space-ui="..."]\` component hooks (a different package, a different audience — see that
 * file's own header). This one targets \`@zanix/space\`'s own \`[data-space="..."]\` hooks instead —
 * the stable attribute the framework's built-in \`not-found\`/\`error\` fallback views (and the
 * CLI's own scaffolded templates — \`welcome\`, \`population\`) render on their root element.
 * \`data-space\` and \`data-space-ui\` are two independent attributes on purpose: \`@zanix/space\` and
 * \`@zanix/space-ui\` are two independent packages, and neither one's markup contract belongs to the
 * other.
 *
 * Every rule below references only SEMANTIC \`--space-*\` tokens declared in \`./tokens.css\` (never a
 * primitive, never a literal) — the same discipline \`./behavior.css\` already follows, so a host
 * overriding this project's palette (\`docs/theming.md\`'s own base→host cascade) restyles these
 * views too, with no separate mechanism.
 */

[data-space='not-found'],
[data-space='error'] {
  display: block;
  margin: 3rem auto;
  max-width: 32rem;
  padding: 0 var(--space-space-md, 1rem);
  text-align: center;
  color: var(--space-color-ink);
}

[data-space='content'] {
  margin: 3rem auto;
  max-width: 56.25rem;
  padding: 0 var(--space-space-md, 1rem);
  color: var(--space-color-ink);
}

[data-space='content'] a {
  color: var(--space-color-primary);
}

[data-space='content'] a:hover {
  color: var(--space-color-primary-strong);
}
`

/**
 * Decorative "deep space" CSS: a starfield, a slowly-crossing CSS-only rocket, an astronaut badge,
 * and the flight animation the astronaut Comet demo's own launched-comet element plays. Scoped
 * entirely under `[data-space="content"]`/`body`/`.comet-*`/`[data-space-ui="button"|"link"]` — no
 * selector here reaches outside those, so a project that deletes this one file loses only the
 * decorative layer, never any structural behavior `behavior.css`/`card.css`/`space-defaults.css`
 * provide.
 *
 * `.comet-launchpad`/`.comet-icon-hidden`/`.comet-launch` are this file's one real behavioral
 * contract with `astronautCometTemplate`'s own generated component below — their class names and
 * the `comet-launch-flight` animation's duration (1.4s) must stay in sync with that component's own
 * `COMET_FLIGHT_DURATION_MS` constant.
 *
 * Every `main[data-space="content"]`-rooted selector below is shared by EVERY CLI-scaffolded
 * template (`welcome`, `population`, and any future one — see `space-welcome.ts`'s own doc for why
 * `data-space="content"` is a single generic value, never a per-`--template` one) — a rule that
 * describes generic layout/typography (the centered column, `h1`/`h2`/`p`/`li` treatment, the
 * starfield/grid backdrop) reaches every one of them automatically, with zero extra selectors to
 * add when a future template joins. `.welcome-emoji`, `[data-comet]`, and the 4-item feature list's
 * own `li:nth-child(3|4)` icon overrides are the one deliberate exception — those describe
 * `--template welcome`'s OWN specific markup (its badge, its live Comet demo card, its exact
 * 4-item list), which no other template renders, so they stay bare class/attribute selectors with
 * no `data-space` scoping at all, simply inert against a page that never has that markup.
 *
 * The bare `code`/`pre` rules in `@layer base` below are the OTHER deliberate exception to the
 * `data-space`-scoped pattern this file otherwise follows — both are genuinely content-agnostic
 * (any inline `<code>` or block `<pre>`, on any page, any `--template`), matching the same
 * unscoped treatment `[data-space-ui="button"|"link"]` already gets. `--template population`'s own
 * tutorial page is the first real content this scaffold generates that uses either.
 */
export const LOCAL_ASTRONAUT_DECORATIONS_CSS = `
/* =========================================================
ZANIX SPACE — ASTRONAUT THEME
Full viewport space / stars / comet / orbit / rocket
========================================================= */

@layer base {
  :root {
    --astro-bg: #05070b;
    --astro-surface: #0d1118;
    --astro-surface-2: #111722;

    --astro-border: rgba(255, 255, 255, 0.09);

    --astro-text: #f4f1e8;
    --astro-muted: #9da5b4;

    --astro-amber: #ffb547;
    --astro-amber-bright: #ffd078;
    --astro-amber-soft: rgba(255, 181, 71, 0.12);
    --astro-amber-glow: rgba(255, 181, 71, 0.25);
  }

  html {
    min-height: 100%;
    background: var(--astro-bg);
    color-scheme: dark;
  }

  body {
    position: relative;

    min-height: 100vh;
    margin: 0;

    overflow-x: hidden;

    color: var(--astro-text);

    background-image:
      radial-gradient(
      ellipse 70% 40% at 50% 0%,
      rgba(255, 181, 71, 0.055),
      transparent 75%
    );

    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;

    line-height: 1.7;

    -webkit-font-smoothing: antialiased;
  }

  ::selection {
    color: #111;
    background: var(--astro-amber);
  }

  code {
    padding: 0.15rem 0.4rem;

    border: 1px solid var(--astro-border);
    border-radius: 5px;

    color: var(--astro-amber-bright);

    background: rgba(255, 255, 255, 0.045);

    font-family:
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      monospace;

    font-size: 0.86em;
  }

  /* Block-level sibling to \`code\` above — a literal source excerpt (e.g. \`--template
  population\`'s own ICU-catalog example), never a syntax highlighter target. Same unscoped,
  any-page treatment. */
  pre {
    padding: 0.75rem 1rem;

    overflow-x: auto;

    border: 1px solid var(--astro-border);
    border-radius: 8px;

    color: var(--astro-amber-bright);

    background: rgba(255, 255, 255, 0.045);

    font-family:
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      monospace;

    font-size: 0.86em;
    line-height: 1.5;
  }
}

/* =========================================================
SPACE BACKGROUND
IMPORTANT:
These layers belong to BODY, not MAIN.
Therefore they cover the entire viewport.
========================================================= */

@layer components {
  body::before {
    content: "";

    position: fixed;
    inset: 0;

    z-index: -20;

    pointer-events: none;

    opacity: 0.5;

    background-image:
      radial-gradient(
      circle,
      rgba(255, 255, 255, 0.75) 0 0.5px,
      transparent 0.8px
    ),
      radial-gradient(
      circle,
      rgba(255, 255, 255, 0.45) 0 0.4px,
      transparent 0.7px
    ),
      radial-gradient(
      circle,
      rgba(255, 181, 71, 0.45) 0 0.5px,
      transparent 0.8px
    );

    background-size:
      150px 150px,
      230px 230px,
      300px 300px;

    animation: stars-drift 90s linear infinite;
  }

  /* Deep-space stars. */
  body::after {
    content: "";

    position: fixed;
    inset: -50%;

    z-index: -19;

    width: 200%;
    height: 200%;

    pointer-events: none;

    opacity: 0.2;

    background-image:
      radial-gradient(
      circle,
      rgba(255, 199, 102, 0.95) 0 1.5px,
      transparent 1.8px
    );

    background-size: 320px 320px;

    animation: stars-deep-drift 140s linear infinite;
  }

  /* =======================================================
  ROCKET
  ======================================================= */

  /* The rocket is created entirely with CSS. It crosses the upper part of the viewport slowly. */
  body {
    --rocket-size: 34px;
  }
  body > [data-space-outlet]::before {
    content: "🚀";

    position: fixed;

    z-index: -5;

    top: 18%;
    left: -70px;

    font-size: var(--rocket-size);

    filter:
      drop-shadow(
      0 0 8px rgba(255, 181, 71, 0.45)
    );

    pointer-events: none;

    animation:
      rocket-flight 18s linear infinite;
  }

  /* =======================================================
  NOT FOUND
  ======================================================= */

  /* \`--template welcome\`'s built-in not-found copy (\`space-astronaut.ts\`'s own \`--theme astronaut\`
  branch of \`notFoundTemplate\`) flies its own rocket inline in the heading — hide the ambient
  background one from ROCKET above while that page is on screen, so there's only ever one rocket
  in view at a time. \`:has()\` reaches up to \`body\` from a descendant with no JS needed; scoped by
  \`[data-space='not-found']\` so no other page is affected. */
  body:has([data-space="not-found"]) > [data-space-outlet]::before {
    content: none;
  }

  /* The not-found page's own inline rocket — same \`astronaut-float\` bob/tilt \`.welcome-emoji\`
  already uses, for one consistent "hovering" identity across every animated emoji this theme
  ships, rather than a one-off animation for just this page. */
  .not-found-rocket {
    display: inline-block;
    animation: astronaut-float 3s ease-in-out infinite;
  }

  /* =======================================================
  MAIN
  ======================================================= */

  main[data-space="content"] {
    position: relative;

    width: min(
      calc(100% - 2rem),
      900px
    );

    margin-inline: auto;

    padding:
      clamp(3rem, 9vw, 6rem)
      0
      clamp(4rem, 10vw, 7rem);
  }

  /* Subtle grid covering the viewport. */
  main[data-space="content"]::before {
    content: "";
    position: fixed;
    inset: 0;

    z-index: -15;

    pointer-events: none;

    opacity: 0.13;

    background-image:
      linear-gradient(
      rgba(255, 255, 255, 0.025) 1px,
      transparent 1px
    ),
      linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.025) 1px,
      transparent 1px
    );

    background-size: 48px 48px;

    mask-image:
      linear-gradient(
      to bottom,
      black,
      transparent 85%
    );
  }

  /* Ambient planet / nebula. */
  main[data-space="content"]::after {
    content: "";
    position: fixed;

    top: -18rem;
    right: -18rem;

    width: 40rem;
    height: 40rem;

    z-index: -14;

    pointer-events: none;

    border-radius: 50%;

    background:
      radial-gradient(
      circle at 35% 35%,
      rgba(255, 199, 102, 0.15),
      rgba(255, 181, 71, 0.035) 45%,
      transparent 70%
    );

    filter: blur(2px);
  }

  /* =======================================================
  ASTRONAUT
  ======================================================= */

  .welcome-emoji {
    position: relative;

    display: grid;
    place-items: center;

    width: 84px;
    height: 84px;

    margin: 0 0 2rem;

    border:
      1px solid rgba(255, 181, 71, 0.25);

    border-radius: 24px;

    background:
      radial-gradient(
      circle at 50% 35%,
      rgba(255, 199, 102, 0.15),
      transparent 65%
    ),
      rgba(255, 255, 255, 0.025);

    box-shadow:
      0 0 0 8px rgba(255, 181, 71, 0.025),
      0 0 45px rgba(255, 181, 71, 0.08);

    font-size: 2.75rem;

    animation:
      astronaut-float 5s ease-in-out infinite,
      astronaut-glow 4s ease-in-out infinite;
  }

  .welcome-emoji::before {
    content: "";

    position: absolute;

    inset: -10px;

    border:
      1px solid rgba(255, 181, 71, 0.12);

    border-radius: 50%;

    transform:
      rotate(-15deg)
      scaleY(0.35);

    pointer-events: none;
  }

  .welcome-emoji::after {
    content: "";

    position: absolute;

    top: -6px;
    right: 14px;

    width: 5px;
    height: 5px;

    border-radius: 50%;

    background: var(--astro-amber);

    box-shadow:
      0 0 8px var(--astro-amber),
      0 0 18px var(--astro-amber-glow);

    animation:
      beacon 2s ease-in-out infinite;
  }

  /* =======================================================
  HERO
  ======================================================= */

  main[data-space="content"] h1 {
    max-width: 760px;

    margin: 0 0 1.25rem;

    color: #fff;

    font-size:
      clamp(
      2.4rem,
      7vw,
      4.8rem
    );

    font-weight: 700;

    line-height: 0.98;

    letter-spacing: -0.055em;

    text-wrap: balance;
  }

  main[data-space="content"] > p:not(.welcome-emoji):first-of-type {
    max-width: 720px;

    color: var(--astro-muted);

    font-size:
      clamp(
      0.98rem,
      2vw,
      1.08rem
    );
  }

  main[data-space="content"] > p strong {
    color: var(--astro-text);
  }

  /* =======================================================
  SECTION TITLES
  ======================================================= */

  main[data-space="content"] h2 {
    position: relative;

    margin-top:
      clamp(
      3.5rem,
      8vw,
      4.5rem
    );

    margin-bottom: 1rem;

    padding-left: 1.25rem;

    color: #fff;

    font-size:
      clamp(
      1.05rem,
      2vw,
      1.15rem
    );

    font-weight: 650;

    letter-spacing: -0.015em;
  }

  /*
  The actual \`::before\` bar/icon lives unlayered, in the H2 section near the bottom of this
  file — right next to the \`h2:nth-of-type(1)\` comet-icon override it needs to keep winning
  against. A layered copy here would always lose to that unlayered one anyway (cascade layers
  rule: unlayered beats layered regardless of specificity), so there is deliberately only one.
  */

  main[data-space="content"] p:not(.welcome-emoji),
  main[data-space="content"] li {
    color: var(--astro-muted);
  }

  /* =======================================================
  COMET
  ======================================================= */

  main[data-space="content"] [data-comet] {
    position: relative;

    margin: 1.75rem 0;

    padding: 1.25rem 1.35rem;

    overflow: hidden;

    border:
      1px solid var(--astro-border);

    border-radius: 14px;

    background:
      linear-gradient(
      135deg,
      rgba(255, 181, 71, 0.055),
      rgba(255, 255, 255, 0.018)
    );

    box-shadow:
      0 20px 50px rgba(0, 0, 0, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.035);

    transition:
      transform 220ms ease,
      border-color 220ms ease,
      box-shadow 220ms ease;
  }

  main[data-space="content"] [data-comet]::before {
    content: "COMET // LIVE";

    display: block;

    margin-bottom: 0.7rem;

    color: var(--astro-amber);

    font-family:
      ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;

    font-size: 0.65rem;

    font-weight: 700;

    letter-spacing: 0.14em;
  }

  main[data-space="content"] [data-comet]::after {
    content: "";

    position: absolute;

    left: -100%;
    top: 0;

    width: 30%;
    height: 1px;

    background:
      linear-gradient(
      90deg,
      transparent,
      var(--astro-amber),
      transparent
    );

    opacity: 0.5;

    animation:
      comet-scan 5s ease-in-out infinite;
  }

  main[data-space="content"] [data-comet]:hover {
    transform: translateY(-3px);

    border-color:
      rgba(255, 181, 71, 0.3);

    box-shadow:
      0 25px 60px rgba(0, 0, 0, 0.32),
      0 0 35px rgba(255, 181, 71, 0.06);
  }

  main[data-space="content"] [data-comet] p {
    margin: 0 0 0.9rem;

    color: var(--astro-text);

    font-family:
      ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
  }

  /*
  Positioning context for \`.comet-launch\` below — scoped to the BUTTON's own wrapper, so the
  takeoff point lines up with the button's own icon on its right edge.
  */
  .comet-launchpad {
    position: relative;
    display: inline-block;
  }

  /*
  Reserves the icon's own layout space even while hidden mid-launch (\`visibility: hidden\`, not
  removed from the tree) — keeps the button's width fixed instead of shrinking/growing as the icon
  disappears and reappears.
  */
  .comet-icon-hidden {
    visibility: hidden;
  }

  /*
  One real comet, launched on click (\`ExampleCounter\`'s own \`key={launches}\` remounts a fresh node
  each time, which is what restarts the animation below — no manual reflow trick needed).
  \`position: absolute\` against \`.comet-launchpad\` above (not \`fixed\`) so it takes off from the
  button's own right edge, matching the button icon's own position — \`vw\`/\`vh\` travel distances in
  the keyframe still carry it off-screen regardless of where on the page that location is.
  */
  .comet-launch {
    position: absolute;
    bottom: 0;
    right: 0;

    z-index: 5;

    pointer-events: none;

    filter:
      drop-shadow(
      0 0 10px var(--astro-amber-glow)
    );

    animation:
      comet-launch-flight 1.4s ease-in forwards;
  }

  /* =======================================================
  WHAT MAKES SPACE DIFFERENT
  ======================================================= */

  main[data-space="content"] li {
    position: relative;

    padding:
      0.85rem
      1rem
      0.85rem
      2.8rem;

    border:
      1px solid transparent;

    border-radius: 10px;

    transition:
      background 180ms ease,
      border-color 180ms ease,
      transform 180ms ease;
  }
  main[data-space="content"] ul {
    list-style: none;
    padding-left: 0;
  }
  main[data-space="content"] li::before {
    content: "↗";

    position: absolute;

    left: 1rem;
    top: 0.85rem;

    color: var(--astro-amber);

    font-family:
      ui-monospace,
      monospace;

    font-size: 0.8rem;

    transition:
      transform 180ms ease;
  }

  /* COMETS — the second feature in the list. */
  main[data-space="content"] li:nth-child(3)::before {
    content: "☄";

    font-size: 1rem;

    animation:
      comet-icon 2.5s ease-in-out infinite;
  }

  /* ORBIT — the fourth feature in the list. */
  main[data-space="content"] li:nth-child(4)::before {
    content: "";
    left: 0.95rem;
    top: 0.85rem;

    width: 15px;
    height: 15px;

    border:
      1px solid var(--astro-amber);

    border-radius: 50%;

    transform:
      rotate(-25deg)
      scaleY(0.42);

    box-shadow:
      0 0 7px rgba(255, 181, 71, 0.18);

    animation:
      orbit-icon 3s linear infinite;
  }

  /* Small planet inside Orbit icon. */
  main[data-space="content"] li:nth-child(4)::after {
    content: "";
    position: absolute;

    left: 1.3rem;
    top: 1.05rem;

    width: 6px;
    height: 6px;

    border-radius: 50%;

    background: var(--astro-amber);

    box-shadow:
      0 0 7px rgba(255, 181, 71, 0.35);
  }

  main[data-space="content"] li:hover {
    border-color:
      var(--astro-border);

    background:
      rgba(255, 255, 255, 0.025);

    transform:
      translateX(3px);
  }

  main[data-space="content"] li:hover::before {
    transform:
      translate(2px, -2px);
  }

  /* Don't apply the generic hover transform to Orbit's ring. */
  main[data-space="content"] li:nth-child(4):hover::before {
    transform:
      rotate(-25deg)
      scaleY(0.42)
      translate(2px, -2px);
  }

  /* =======================================================
  BUTTON
  ======================================================= */

  [data-space-ui="button"] {
    appearance: none;

    min-height: 42px;

    border:
      1px solid rgba(255, 181, 71, 0.45);

    border-radius: 8px;

    padding:
      0.6rem
      0.9rem;

    color: #17120a;

    background:
      linear-gradient(
      180deg,
      var(--astro-amber-bright),
      var(--astro-amber)
    );

    font: inherit;

    font-size: 0.9rem;
    font-weight: 700;

    cursor: pointer;

    box-shadow:
      0 0 0 0 rgba(255, 181, 71, 0.25),
      0 6px 20px rgba(255, 181, 71, 0.08);

    transition:
      transform 150ms ease,
      box-shadow 150ms ease;
  }

  [data-space-ui="button"]:hover {
    transform: translateY(-1px);

    box-shadow:
      0 0 0 5px rgba(255, 181, 71, 0.06),
      0 8px 25px rgba(255, 181, 71, 0.16);
  }

  [data-space-ui="button"]:active {
    transform:
      translateY(1px)
      scale(0.98);
  }

  [data-space-ui="button"]:focus-visible {
    outline:
      2px solid var(--astro-amber-bright);

    outline-offset: 3px;
  }

  /* =======================================================
  LINKS
  ======================================================= */

  [data-space-ui="link"] {
    color: var(--astro-amber);

    text-decoration: none;

    transition:
      color 160ms ease,
      text-shadow 160ms ease;
  }

  [data-space-ui="link"]::after {
    content: " ↗";

    display: inline-block;

    transition:
      transform 160ms ease;
  }

  [data-space-ui="link"]:hover {
    color: var(--astro-amber-bright);

    text-shadow:
      0 0 18px rgba(255, 181, 71, 0.25);
  }

  [data-space-ui="link"]:hover::after {
    transform:
      translate(2px, -2px);
  }

  [data-space-ui="link"]:focus-visible {
    outline:
      2px solid var(--astro-amber);

    outline-offset: 4px;

    border-radius: 3px;
  }

  /* =======================================================
  FINAL PARAGRAPH
  ======================================================= */

  main[data-space="content"] > p:last-child {
    margin-top: 2rem;

    padding-top: 1.5rem;

    border-top:
      1px solid var(--astro-border);

    font-size: 0.9rem;
  }
}

/* =========================================================
ANIMATIONS
========================================================= */

@keyframes stars-drift {
  from {
    background-position:
      0 0,
      0 0,
      0 0,
      0 0;
  }

  to {
    background-position:
      140px 90px,
      -100px 160px,
      180px -80px,
      -120px 130px;
  }
}

@keyframes stars-deep-drift {
  from {
    transform:
      translate3d(0, 0, 0);
  }

  to {
    transform:
      translate3d(-180px, 140px, 0);
  }
}

/* Horizontal travel is capped with min(Xvw, Ypx), not a bare vw value: an uncapped vw distance
grows unbounded with viewport width, while the centered main content's own column stops growing
past its 900px max-width — the gap between the two shrank enough at some in-between viewport
widths that the rocket drifted into the text column. The px caps keep its rightmost reach a
fixed ~20px past the left edge (from the -70px starting position above) regardless of viewport
width, clear of that column at any width where centering actually creates a real side margin. */
@keyframes rocket-flight {
  0% {
    transform:
      translate3d(0, 110vh, 0)
      rotate(-45deg);
    opacity: 0;
  }

  8% {
    opacity: 1;
  }

  35% {
    transform:
      translate3d(min(8vw, 40px), 45vh, 0)
      rotate(-45deg);
  }

  65% {
    transform:
      translate3d(min(15vw, 70px), -10vh, 0)
      rotate(-45deg);
  }

  90% {
    opacity: 0.8;
  }

  100% {
    transform:
      translate3d(min(20vw, 90px), -50vh, 0)
      rotate(-45deg);
    opacity: 0;
  }
}

@keyframes comet-launch-flight {
  0% {
    transform: translate3d(0, 0, 0);
    opacity: 0;
  }

  10% {
    opacity: 1;
  }

  85% {
    opacity: 1;
  }

  100% {
    transform: translate3d(70vw, -130vh, 0);
    opacity: 0;
  }
}

@keyframes astronaut-float {
  0%,
  100% {
    transform:
      translateY(0)
      rotate(-2deg);
  }

  50% {
    transform:
      translateY(-7px)
      rotate(2deg);
  }
}

@keyframes astronaut-glow {
  0%,
  100% {
    box-shadow:
      0 0 0 8px rgba(255, 181, 71, 0.025),
      0 0 35px rgba(255, 181, 71, 0.06);
  }

  50% {
    box-shadow:
      0 0 0 8px rgba(255, 181, 71, 0.04),
      0 0 55px rgba(255, 181, 71, 0.13);
  }
}

@keyframes beacon {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

@keyframes comet-scan {
  0% {
    left: -30%;
  }

  55%,
  100% {
    left: 110%;
  }
}

@keyframes comet-icon {
  0%,
  100% {
    transform:
      translate(0, 0)
      rotate(-10deg);
  }

  50% {
    transform:
      translate(3px, -2px)
      rotate(-18deg);
  }
}

@keyframes orbit-icon {
  from {
    transform:
      rotate(0deg)
      scaleY(0.42);
  }

  to {
    transform:
      rotate(360deg)
      scaleY(0.42);
  }
}

/* =========================================================
RESPONSIVE
========================================================= */

@media (max-width: 640px) {
  main[data-space="content"] {
    width:
      min(
      calc(100% - 4rem),
      900px
    );

    padding-top: 3rem;
    padding-bottom: 4rem;
  }

  .welcome-emoji {
    width: 68px;
    height: 68px;

    margin-bottom: 1.75rem;

    border-radius: 19px;

    font-size: 2.2rem;
  }

  main[data-space="content"] h1 {
    font-size:
      clamp(
      2.35rem,
      13vw,
      3.5rem
    );

    letter-spacing: -0.06em;
  }

  main[data-space="content"] h2 {
    margin-top: 3.25rem;
  }

  main[data-space="content"] p {
    font-size: 0.96rem;
  }

  main[data-space="content"] [data-comet] {
    padding: 1rem;

    border-radius: 12px;
  }

  main[data-space="content"] li {
    padding-left: 2.45rem;

    font-size: 0.94rem;
  }

  /* Less visual density on small screens. */
  body::before {
    opacity: 0.45;
    background-size:
      101px 101px,
      163px 163px,
      211px 211px,
      137px 137px;
  }

  body::after {
    opacity: 0.18;
  }

  main[data-space="content"]::before {
    background-size: 32px 32px;

    opacity: 0.08;
  }

  /* Smaller rocket on phones. */
  body {
    --rocket-size: 25px;
  }
  body > [data-space-outlet]::before {
    top: 14%;
  }
}

/* =========================================================
H2
========================================================= */

main[data-space="content"] h2::before {
  content: "";

  position: absolute;

  left: 0;
  top: 0.35em;

  width: 3px;
  height: 1.1em;

  border-radius: 999px;

  background: var(--astro-amber);

  box-shadow:
    0 0 12px var(--astro-amber-glow);
}

main[data-space="content"] h2:nth-of-type(1)::before {
  content: "☄";

  display: block;

  position: absolute;

  left: 0;
  top: 0;

  width: auto;
  height: auto;

  color: var(--astro-amber);

  background: none;
  box-shadow: none;

  font-size: 1rem;

  animation:
    comet-title 2.5s ease-in-out infinite;
}

/* =========================================================
VERY SMALL DEVICES
========================================================= */

@media (max-width: 380px) {
  main[data-space="content"] {
    width:
      min(
      calc(100% - 3rem),
      900px
    );
  }

  .welcome-emoji {
    width: 60px;
    height: 60px;

    font-size: 2rem;
  }

  main[data-space="content"] h1 {
    font-size: 2.25rem;
  }

  main[data-space="content"] h2 {
    font-size: 1rem;
  }

  [data-space-ui="button"] {
    width: 100%;
  }
}

/* =========================================================
ACCESSIBILITY
========================================================= */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;

    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;

    transition-duration: 0.01ms !important;
  }
}
`

/** The real `globalCss` entries {@linkcode getSpaceAppTemplate} (`space.ts`) writes for `--theme
 * astronaut` — `tokens.css` first (declares the custom properties everything else consumes), then
 * the two shared, unmodified files, then `space-defaults.css` (layered on top so it can override
 * anything the others declare for `@zanix/space`'s own built-in hooks), and finally
 * `astronaut.css` LAST — the purely decorative layer, free to add on top of everything above it. */
export function getAstronautGlobalCssPaths(): string[] {
  return [
    `./theme/${ASTRONAUT_TOKENS_TARGET}`,
    ...SHARED_THEME_FILES.map(({ target }) => `./theme/${target}`),
    `./theme/${ASTRONAUT_SPACE_DEFAULTS_TARGET}`,
    `./theme/${ASTRONAUT_DECORATIONS_TARGET}`,
  ]
}

/**
 * Writes already-resolved theme file contents to `${root}/theme/<target>` — the shared JSR
 * pair (`contents`, keyed by `source`) plus the three embedded constants above, unconditionally.
 * Same split as `writeThemeFiles` (`space-theme.ts`): testable independently of the JSR fetch/
 * publish gate in `resolveSpaceUiVersion`.
 */
export async function writeAstronautFiles(
  root: string,
  contents: Record<string, string>,
): Promise<void> {
  const targetDir = join(root, 'theme')
  await Deno.mkdir(targetDir, { recursive: true })

  await Promise.all([
    Deno.writeTextFile(join(targetDir, ASTRONAUT_TOKENS_TARGET), LOCAL_ASTRONAUT_TOKENS_CSS),
    ...SHARED_THEME_FILES.map(({ source, target }) => {
      const content = contents[source]
      if (content === undefined) {
        throw new Error(`writeAstronautFiles: missing content for "${source}"`)
      }
      return Deno.writeTextFile(join(targetDir, target), content)
    }),
    Deno.writeTextFile(
      join(targetDir, ASTRONAUT_SPACE_DEFAULTS_TARGET),
      LOCAL_ASTRONAUT_SPACE_DEFAULTS_CSS,
    ),
    Deno.writeTextFile(
      join(targetDir, ASTRONAUT_DECORATIONS_TARGET),
      LOCAL_ASTRONAUT_DECORATIONS_CSS,
    ),
  ])
}

/** Best-effort removal of exactly the one path {@linkcode copyAstronautAssets} itself ever writes
 * — same reasoning as `space-theme.ts`'s own `cleanupThemeOutput`. */
async function cleanupAstronautOutput(root: string): Promise<void> {
  try {
    await Deno.remove(join(root, 'theme'), { recursive: true })
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}

/**
 * The full `--theme astronaut` theme side effect: fetches the two shared
 * {@linkcode SHARED_THEME_FILES} entries from the resolved `@zanix/space-ui` version (same
 * {@linkcode getSpaceUiThemeTemplate} `space-theme.ts` itself uses), writes them plus the three
 * embedded constants via {@linkcode writeAstronautFiles}. Same throw/cleanup contract as
 * `copyThemeAssets` — its caller (`ensureSpaceScaffoldSideEffects`, `space.ts`) decides to catch and
 * degrade gracefully instead of propagating further.
 */
export async function copyAstronautAssets(root: string): Promise<void> {
  try {
    const entries = await Promise.all(
      SHARED_THEME_FILES.map(
        async ({ source }) => [source, await getSpaceUiThemeTemplate(source)] as const,
      ),
    )
    await writeAstronautFiles(root, Object.fromEntries(entries))
  } catch (error) {
    await cleanupAstronautOutput(root)
    throw error
  }
}

// -------------------------------------------------------------------------------------------
// Comet demo (comets/<name>.comet.tsx)
// -------------------------------------------------------------------------------------------

/**
 * `comets/<name>.comet.tsx` for `--theme astronaut` — unlike `generate/comet/template.ts`'s own
 * generic `cometTemplate` (a placeholder `<div>`), this is a real, interactive demo matching
 * `LOCAL_ASTRONAUT_DECORATIONS_CSS`'s own `.comet-launch*` classes and `comet-launch-flight`
 * keyframe: clicking the button launches a comet-shaped SVG across the screen, timed to
 * `COMET_FLIGHT_DURATION_MS` (must stay in sync with that animation's own 1.4s duration).
 *
 * Takes an optional `renderer` (`--renderer`, `lib/renderer.ts`'s own `RendererName`) — both of
 * this component's own runtime imports resolve through that module's shared helpers
 * ({@linkcode getHooksEntry} for `useState`, {@linkcode getSpaceUiEntry} for `Button`), the same
 * ones `space-icons.ts`/`space-welcome.ts` already use, so this demo never ends up importing
 * React's `useState`/`@zanix/space-ui`'s React build into a `--renderer preact` project.
 */
export const astronautCometTemplate = (
  pascalName: string,
  renderer: RendererName | undefined = undefined,
): string =>
  `'use comet'

import { useState } from '${getHooksEntry(renderer)}'
import { defineComet } from '@zanix/space/comet'
import { Button } from '${getSpaceUiEntry(renderer)}'

interface CometIconProps {
  /** Rendered width/height, in px. @default 20 */
  size?: number
  className?: string
}

// \`size\` is explicit at each call site (never a shared default) — the button usage needs to stay
// small so the icon doesn't widen the button, while the flying \`.comet-launch\` usage reads better
// bigger. \`.comet-launch\`'s own keyframe applies no rotation, so no "heading" orientation to match.
function CometIcon({ size = 20, className }: CometIconProps) {
  return (
    <svg viewBox='0 0 64 64' width={size} height={size} aria-hidden='true' className={className}>
      {/* Comet tail / glow */}
      <path d='M12 52 L36 36 L28 28 Z' fill='#ffb347' opacity={0.6} />
      <path d='M8 56 L44 32 L32 20 Z' fill='#ff6a00' opacity={0.4} />
      {/* Comet head (nucleus) */}
      <circle cx='46' cy='18' r='10' fill='#e8380d' />
      <circle cx='44' cy='16' r='4' fill='#ffd166' />
    </svg>
  )
}

// Must match \`.comet-launch-flight\`'s own duration in \`theme/astronaut.css\` — this is
// when the button's icon reappears, timed to the flying copy finishing its animation.
const COMET_FLIGHT_DURATION_MS = 1400

export function ${pascalName}() {
  const [launches, setLaunches] = useState(0)
  const [launching, setLaunching] = useState(false)

  function handleLaunch() {
    setLaunches((n) => n + 1)
    setLaunching(true)
    setTimeout(() => setLaunching(false), COMET_FLIGHT_DURATION_MS)
  }

  return (
    <div>
      <p>Comets launched: {launches}</p>
      <span className='comet-launchpad'>
        <Button onClick={handleLaunch}>
          Launch a comet{' '}
          <CometIcon size={18} className={launching ? 'comet-icon-hidden' : undefined} />
        </Button>
        {launching && (
          <span key={launches} className='comet-launch'>
            <CometIcon size={36} />
          </span>
        )}
      </span>
    </div>
  )
}

export default defineComet(${pascalName}, import.meta.url)
`

/**
 * Pure planning for `--theme astronaut`'s own example Comet — same `plan<Name>(kebabName,
 * pascalName, cometsFolder)` shape `generate/comet/command.ts`'s own `planComet` follows, writing
 * to the exact same `${cometsFolder}/${kebabName}.comet.tsx` path.
 */
export function planAstronautComet(
  kebabName: string,
  pascalName: string,
  cometsFolder: string,
  renderer: RendererName | undefined = undefined,
): CometPlan {
  return {
    files: [
      {
        PATH: `${cometsFolder}/${kebabName}.comet.tsx`,
        NAME: `${kebabName}.comet.tsx`,
        content: () => Promise.resolve(astronautCometTemplate(pascalName, renderer)),
      } satisfies CometPlanFile,
    ],
  }
}
