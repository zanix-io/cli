# `zanix new` — bootstrap a project

`zanix new <type> [name]` creates a whole new Zanix project from scratch — the
counterpart to [`zanix generate`](./generate.md), which adds one artifact to a
project that already exists. Unlike `generate`, there's no separate `root`
argument: `[name]` doubles as the target folder, created relative to the current
directory (or as an absolute/relative path of its own).

```bash
zanix new <type> [name]
```

| Type       | Command                       | Default name          | Creates                                          |
| ---------- | ----------------------------- | --------------------- | ------------------------------------------------ |
| App        | `zanix new app [name]`        | `my-zanix-app`        | A `defineZanixApp()` manifest package (`mod.ts`) |
| Space      | `zanix new space [name]`      | `my-zanix-space`      | A `@zanix/space` frontend app (`src/space/`)     |
| Server     | `zanix new server [name]`     | `my-zanix-server`     | A backend server (`src/server/`)                 |
| Spacecraft | `zanix new spacecraft [name]` | `my-zanix-spacecraft` | A `space` frontend + a `server`, in one project  |
| Library    | `zanix new library [name]`    | `my-zanix-library`    | A reusable library (`src/modules/`)              |

Every type shares the same options:

| Option                      | Default   | Description                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --template <template>` | `'base'`  | The scaffold template to use — `'base'` everywhere, plus `'welcome'`, `'population'`, and `'population-lang'` for **space**/**spacecraft** (see [`--template welcome`](#--template-welcome) and the `--template population` section below). Visual identity is a separate flag — see [`--theme`](#--theme). |
| `--no-prepare`              | (runs)    | Skip the automatic `zanix prepare -g -e` call that otherwise runs afterward.                                                                                                                                                                                                                                |
| `--verify`                  | (skipped) | Opt-in: run `deno check` against the new project and warn (never fail) if it doesn't compile against the currently installed dependency versions. See [`--verify`](#--verify).                                                                                                                              |

**Space** and **spacecraft** ALSO get four more options, unavailable for every other type (a plain
`app`/`server`/`library` project has no renderer/icon-catalog/theme/special-pages concept at all):

| Option                  | Default   | Description                                                                                                                                                                                   |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--renderer <renderer>` | `'react'` | `'react'` (the full renderer) or `'preact'` (a smaller, specialized renderer for Comets/islands and pages whose data resolves entirely inside their own `loader`). See [Space](#space) below. |
| `--icons`               | (off)     | Scaffolds `@zanix/space-ui`'s default icon catalog into `assets/icons/`. See [`--icons`](#--icons) below.                                                                                     |
| `--theme <theme>`       | (unset)   | The visual identity to scaffold into `theme/`: `'default'` or `'astronaut'`. See [`--theme`](#--theme) below.                                                                                 |
| `--pages <pages>`       | (unset)   | Comma-separated special pages to pre-seed: `'error'` and/or `'not-found'`. See [`--pages`](#--pages) below.                                                                                   |

## What every project gets

Regardless of type, `zanix new` always seeds:

- `README.md`, `CHANGELOG.md`, `LICENSE` at the project root (a library or an
  app additionally gets a root `mod.ts` — see their own sections below for what
  it contains). `LICENSE`'s `Copyright (c) [YEAR] [ORGANIZATION]` gets `[YEAR]`
  filled in with the real current year — the one part `zanix new` can actually
  know. `[ORGANIZATION]` is left as-is, on purpose: same as the generated
  `deno.json`'s `@your-scope` package name, the CLI can never know a user's
  real copyright holder, so it's left as an unmistakable placeholder to
  hand-edit before publishing, not something guessed from the project name or
  a GitHub org.
- `docs/see-more.md` — a starter guide for project-specific documentation links.
- `.dist/` (empty, the build output folder — see [`build`](./build.md)).
- `src/@tests/{integration,unit,functional}/example.test.ts`.
- `src/typings/index.d.ts`, `src/utils/example.ts`.
- `deno task check-cycles` / `deno task check-duplicates` in the generated
  `deno.json`, always — unlike `dev`/`start`/`worker` (below, runnable types
  only), these two are read-only checks against the project's own
  source/lockfile, meaningful for a `library` just as much as a runnable
  service. See [`check-cycles`](./check-cycles.md)/
  [`check-duplicates`](./check-duplicates.md).

Every project type except `library` (i.e. `app`, `space`, `server`, and
`spacecraft`, which is both `space` and `server`) additionally gets:

- `src/shared/middlewares/{example.pipe,example.interceptor}.ts` — the same
  `pipe`/`interceptor` shell `zanix generate middleware --kind pipe|interceptor`
  itself produces (`planMiddleware`, generated locally — no JSR fetch; see
  [`generate.md`](./generate.md#middleware)). `guard` isn't seeded here (only
  these two example kinds are), the same way it always wasn't.

## App

`zanix new app [name]` seeds a real, working `defineZanixApp()` manifest at the
package root (`mod.ts`) — never an empty placeholder:

```ts
import { defineZanixApp, type ZanixAppDefinition } from '@zanix/app'
import logger from '@zanix/utils/logger'

export default defineZanixApp({
  name: 'my-zanix-app',
  onStart: () => {
    logger.info('my-zanix-app started')
  },
}) as ZanixAppDefinition
```

Deliberately protocol-agnostic — a Zanix App is
`manifest + dependencies + resources + routes +
jobs + events + lifecycle`, and
nothing about it requires an HTTP server. No `src/server`/
`src/space`/`src/modules` subfolder is generated either: an `app` package's only
real artifact is this manifest. Add `routes`/`jobs`/`dependencies`/`resources`
once your app actually needs them — see `@zanix/app`'s own README for the full
manifest reference, and its `docs/publishing.md` if you're distributing this as
a package for a different team's host to install. `deno.json` already declares
`@zanix/app`, `@zanix/utils/logger`, and the `exports`/`publish` shape needed to
publish it, same as `library`. The generated `mod.ts` is lint-clean against its
own scaffolded rules: it logs through the real Zanix `logger` (never `console`
— `no-znx-console`'s auto-fix has been published in `@zanix/utils` since `3.0.0`,
well below `cli`'s own `^3.0.0` floor for that subpath) and its default export
is explicitly typed via `as ZanixAppDefinition`, which satisfies JSR's
slow-types check at `deno publish` time (a bare `defineZanixApp({...})`
default export does not).

## Server

`zanix new server [name]` (and `spacecraft`, below) also seeds two root
entrypoints: `mod.ts` (`Zanix.start()`, the HTTP servers) and `worker.ts`
(`Zanix.startWorker()`, a standalone AsyncMQ background-jobs process — no HTTP
at all, always its own separate process from `mod.ts`), plus a matching
`start`/`worker` task pair in `deno.json`. See [`deploy.md`](./deploy.md) for
how to run both in production.

`zanix new server [name]` seeds `src/server/` with one example of every artifact
[`zanix generate`](./generate.md) can produce — generated by calling those exact
same template functions, not a separately maintained copy:

```
src/server/
  connectors/example.connector.ts
  handlers/
    example.handler.ts
    rtos/example.rto.ts
  interactors/example.interactor.ts
  jobs/example.defs.ts
  repositories/
    model.defs.ts
    seeders/seeder.ts
```

## Space

`zanix new space [name]` seeds `src/space/` with `@zanix/space`'s real,
implemented conventions — file-based page routing under `routes/` (`page.tsx`,
one example) and `comets/` for selective-hydration client components
(`example.comet.tsx`, one example):

```
src/space/
  routes/page.tsx
  comets/example.comet.tsx
```

Also declares `assetsDir: './assets'` in `space.app.ts` unconditionally, regardless of
`--icons`/`--theme`/`--template` — `@zanix/space` only registers its `/assets/:path*` route (which
serves `clientBuildDir`'s own hashed production JS/CSS, alongside any real static asset) when
`assetsDir` is actually declared; a scaffold that omitted it would 404 its own production build the
moment one ran. `assets/` itself always exists on disk too (a `.gitkeep` placeholder when nothing
else populates it — see [`--icons`](#--icons) below for when it does). `--theme`'s own CSS lives at
a separate, project-root `theme/` folder instead, deliberately outside `assetsDir`'s own scan path
— see [`--theme`](#--theme) below for why.

### `--renderer`

`zanix new space --renderer=preact` (default: `react`) selects the renderer for the WHOLE
project, never per-file — matching `@zanix/space`'s own `defineSpaceApp({ renderer })` contract
(see that package's own README for the full contract: React gets `Suspense`/`loading.tsx`/full
async semantics; Preact is a deliberately smaller renderer for Comets/islands and pages whose data
resolves entirely inside their own `loader`). Affects exactly two generated files, nothing else —
`comet`/`page`/`layout`/`error`/`loading` are plain, renderer-agnostic JSX that transpiles off
`deno.json`'s own `compilerOptions.jsxImportSource`, regardless of which renderer you picked:

- **`deno.json`** — `compilerOptions.jsxImportSource` and the declared npm dependency (`preact`
  instead of `react`).
- **`space.app.ts`** — `defineSpaceApp({ ..., renderer: 'preact' })`. Omitted entirely for the
  default `react` — identical in every respect to passing `--renderer=react` explicitly.

### `--template welcome`

`zanix new space --template welcome` (default: `'base'`) swaps the generic `Example` landing route
for a real welcome page — the same idea as Handlebars' own default welcome page for a fresh
project — shown at `/` instead of a bare `<h1>Example</h1>`:

```
src/space/
  routes/page.tsx   # a real WelcomePage, composed from @zanix/space-ui's Link
  comets/example.comet.tsx   # unchanged — same example Comet as 'base'
```

The generated page is composed from `@zanix/space-ui` (this project's own headless component
library) — specifically `Link`, for two real outbound links ("Documentation", "GitHub", both
pointing at this ecosystem's real `zanix-io` GitHub org). `--template welcome` declares
`@zanix/space-ui` in the generated `deno.json` on its own, independent of `--icons` — the welcome
page imports it either way.

The page's root `<main>` carries a stable `data-space="content"` hook — an `@zanix/space` attribute
(the same convention `@zanix/space`'s own built-in `not-found`/`error` fallback views use), shared
verbatim with `--template population`'s own root element — ONE generic value every scaffolded
template uses, so any [`--theme`](#--theme) value's own starter CSS only needs one selector to
style either page.

Deliberately independent of both [`--icons`](#--icons) and [`--theme`](#--theme): the welcome page
never references `CatalogIcon`, and neither flag checks which `--template` was used — all three
compose freely, in any combination:

```bash
zanix new space my-app --template welcome                    # welcome page, no icon catalog, no theme
zanix new space my-app --template welcome --icons             # welcome page AND the icon catalog
zanix new space my-app --template welcome --theme astronaut  # welcome page, styled
zanix new space my-app --icons                                # icon catalog, generic Example page
```

One thing DOES vary with `--theme`, not `--template`: the example Comet's own content. See
[`--theme`](#--theme) below for why that axis (not this one) owns it.

`spacecraft` accepts the same flag, applied identically to its own `src/space/routes/page.tsx` —
the server half of a spacecraft project has no landing-page concept of its own, so `--template
welcome` leaves `src/server/` completely unaffected (identical to what `--template base` would
produce there).

### `--template population` / `--template population-lang`

Two mutually-exclusive `--template` values (never combined with `welcome`, or with each other) that
scaffold a real, WORKING i18n/population reference — built from the exact wiring that turned out to
matter live: `src/space/middleware.ts` registering the right guards, `space.app.ts` composing
`definePreHandler`'s registration into the bootstrap config `mod.ts` reads, and `messagesDir`
pointing at a real catalog. Getting any one of those wrong is what silently breaks the whole
mechanism — this template exists so a project starts with all of them correct, rather than
assembled by hand from [`@zanix/space`'s own `docs/i18n.md`](https://github.com/zanix-io/space/blob/master/docs/i18n.md)
and [`docs/middleware.md`](https://github.com/zanix-io/space/blob/master/docs/middleware.md).

- **`population`** — `populationGuard()` only. A single implicit locale, no `/[lang]/...` URL
  prefix. For an app that wants content variants (tenant/segment) without URL-based i18n. Its one
  catalog lives under `messages/default/`, never `messages/en/` — `default` names the folder as
  "this app's only content variant," not a specific language, since no `langPreHandler` resolves a
  real one here.
- **`population-lang`** — everything `population` has, PLUS `langGuard()`/`langPreHandler` and real
  `/[lang]/...` routing, with real `en`/`es` catalogs.

```
src/space/
  middleware.ts              # registers populationGuard() (+ langGuard() for population-lang)
  routes/
    page.tsx                 # population — single implicit locale
    [lang]/page.tsx           # population-lang instead — real /[lang]/... routing
    layout.tsx                # <html lang={...}> root shell
messages/
  default/index.json          # population only — base catalog, plain human-authored ICU strings
  default/populations/beta.json
  en/index.json               # population-lang only — base catalog per real locale
  en/populations/beta.json    # override — only the ONE key it changes
  es/index.json
  es/populations/beta.json
space.app.ts                  # messagesDir: './messages', imports ./src/space/middleware.ts
```

The generated `routes/page.tsx` is NOT a port of `--template welcome`'s landing-page copy — it's a
working tutorial for the mechanism itself: the resolved `lang`/`population` for the CURRENT request,
rendered through real `formatMessage()` calls (so `?population=beta` visibly changes the page — proof
the wiring works, not just a description of it), a real ICU-pluralized message key next to the call
that reads it, and a pointer to the `messages/<lang>/populations/` override this same scaffold
writes a working example of.

`population-lang`'s `space.app.ts` additionally calls
`defineBootstrapSpaceAppConfig({ server: { ssr: { preHandler: getUserPreHandler() } } })` before
`defineSpaceApp(...)` — this is what makes `mod.ts`'s own `getBootstrapSpaceAppConfig()` call
actually serve the `langPreHandler` redirect in production, without any manual wiring.

```bash
zanix new space my-app --template population                       # populationGuard only, single locale
zanix new space my-app --template population-lang                  # + langGuard/langPreHandler, /[lang]/...
zanix new space my-app --template population-lang --theme astronaut --icons --renderer preact
```

Composes freely with [`--theme`](#--theme), [`--icons`](#--icons), and
[`--renderer`](#--renderer) exactly like `welcome` does — none of the three ever checks which
`--template` value is active. `--icons` gates whether `layout.tsx` imports the generated
`CatalogIcon` wrapper; without it, `layout.tsx` has no such import at all.

`spacecraft` accepts both values identically — the server half of such a project has no
i18n/population concept of its own, so neither leaves `src/server/` affected (same as
`--template welcome`).

### `--theme`

`zanix new space --theme <name>` (unset by default — no theme, no `globalCss` field at all) scaffolds
a complete visual identity: real CSS your project owns outright, never a runtime dependency, wired
into `space.app.ts` via the SAME `defineSpaceApp({ globalCss })` mechanism `@zanix/space`'s own
[`docs/theming.md`](https://github.com/zanix-io/space/blob/master/docs/theming.md) already
documents. Completely independent of [`--template`](#--template-welcome) — pick either, both, or
neither:

```bash
zanix new space my-app --theme default              # generic @zanix/space-ui starter palette
zanix new space my-app --theme astronaut            # dark "deep space" identity + comet-launch demo
zanix new space my-app --template welcome --theme astronaut   # both together
```

#### `--theme default`

Copies `@zanix/space-ui`'s curated starter theme — real, minimal CSS, not just a scaffold
placeholder — into a project-root `theme/` folder, a sibling of `assets/`/`src/`, deliberately NOT
nested under `assets/theme/`: see [`--icons`](#--icons) below for why `assetsDir` is now always
declared, and why theme CSS has to stay outside its scan path:

```
theme/
  tokens.css           # primitive + semantic --space-* design tokens (@zanix/space's docs/theming.md convention)
  behavior.css          # theme-agnostic structural/animation CSS (overlay backdrop, spinners, progress bar, ...)
  card.css              # Card's responsive two-column layout
  space-defaults.css    # real styling for @zanix/space's own built-in not-found/error/welcome views
```

```ts
// space.app.ts
export default defineSpaceApp({
  name: 'storefront',
  routesDir: './src/space/routes',
  assetsDir: './assets',
  globalCss: [
    './theme/tokens.css',
    './theme/behavior.css',
    './theme/card.css',
    './theme/space-defaults.css',
  ],
})
```

Never declares `@zanix/space-ui` in the generated `deno.json` — `globalCss` resolves these as
literal CSS source paths directly (dev and production alike), and no `.ts` file this scaffold
writes imports `@zanix/space-ui` just because `--theme default` was passed. Edit, extend, or delete
any of the four files freely — none is imported by `@zanix/space-ui`'s or `@zanix/space`'s own
runtime code.

#### `--theme astronaut`

A complete, distinct dark "deep space" visual identity — same mechanism as `--theme default`, a
different palette, plus TWO things `default` doesn't ship: `astronaut.css` (a decorative starfield,
a CSS-only rocket, and the animation the Comet demo below plays) and a real, interactive Comet
demo, replacing the generic placeholder with a "launch a comet" button that animates a comet-shaped
SVG across the screen — Comet content is the ONE thing `--theme` (not `--template`) decides,
regardless of which `--template` value a project also requested:

```
theme/
  tokens.css            # dark "deep space" primitive + semantic --space-* tokens
  behavior.css          # SAME file --theme default copies, byte-for-byte
  card.css              # SAME file --theme default copies, byte-for-byte
  space-defaults.css    # astronaut's own not-found/error/welcome view styling
  astronaut.css          # decorative starfield, CSS-only rocket, and the comet-launch animation
src/space/
  comets/example.comet.tsx   # the interactive comet-launch demo, not the generic counter
```

Declares `@zanix/space-ui` in the generated `deno.json` on its own (the comet demo imports
`Button` from it), independent of `--icons`.

```bash
zanix new space my-app --theme astronaut                       # theme + interactive comet demo
zanix new space my-app --template base --theme astronaut       # generic Example page, STILL the interactive comet
zanix new space my-app --template welcome --theme astronaut    # welcome copy AND the theme together
```

`spacecraft` accepts `--theme` identically — the server half of a spacecraft project has no
visual-theme concept of its own, so neither value affects `src/server/` at all.

### `--icons`

`zanix new space --icons` (off by default) scaffolds `@zanix/space-ui`'s curated default icon
catalog — a small, Font Awesome Free-sourced SVG sprite — as a plain asset your project owns
outright, never a runtime dependency:

```
assets/icons/
  catalog.svg
  NOTICE.md
  LICENSES/fontawesome-free-7.3.1.txt
src/space/
  catalog-icon.ts
```

`src/space/catalog-icon.ts` re-exports `@zanix/space-ui`'s real `CatalogIcon`, pre-wired to this
project's own hashed `assets/icons/catalog.svg` build URL via `@zanix/space`'s
`resolveAssetHref` — the only thing left for your own code is importing it (relative to wherever
a `page`/`comet` file lives, e.g. `../catalog-icon.ts` from `src/space/routes/`) and passing an
icon `name`:

```ts
import { CatalogIcon } from '../catalog-icon.ts'

export default function Example() {
  return <CatalogIcon name='check' />
}
```

`space.app.ts`'s `assetsDir: './assets'` field is written UNCONDITIONALLY now, regardless of
`--icons` — `@zanix/space` only registers its `/assets/:path*` route (which is what serves
`clientBuildDir`'s own hashed JS/CSS production output, alongside any real static asset) when
`assetsDir` is actually declared; a scaffold that omitted it would 404 its own production build the
moment one ran, `--icons` or not. `assets/` itself always exists on disk too (a `.gitkeep`
placeholder when `--icons` doesn't populate it with anything real), so the folder is never silently
absent from a project's first commit. `--icons` is what makes `assets/icons/catalog.svg` real,
hashed content this route can actually serve — the field itself no longer depends on it.

`--icons` also declares `@zanix/space-ui` in the generated `deno.json`'s own `imports` — the real
package `src/space/catalog-icon.ts` imports from, so a fresh `--icons` scaffold's `deno check`
resolves it immediately, with no manual `deno add` step. Only declared once the icon catalog
itself actually lands on disk — a degraded `--icons` attempt (a real network/fetch failure; see
above) never adds an import for a package the project ends up not actually using.

Deliberately independent of [`--renderer`](#--renderer) (only consulted to pick which
`@zanix/space-ui` entrypoint the wrapper imports from — `@zanix/space-ui` for React,
`@zanix/space-ui/preact` for Preact), [`--template`](#--template-welcome), and
[`--theme`](#--theme) — the icon catalog works with any combination of the other two, or none at
all; see [`--template welcome`](#--template-welcome) and [`--theme`](#--theme) above for the real,
confirmed combinations.

### `--pages`

`zanix new space --pages=error,not-found` (unset by default) pre-seeds special-file pages that
`@zanix/space` discovers by filename convention — the exact same content
[`zanix generate error`/`zanix generate not-found`](./generate-space.md) would produce for an
existing project, reused directly rather than duplicated:

```bash
zanix new space my-app --pages=error              # routes/error.tsx only
zanix new space my-app --pages=not-found          # routes/not-found.tsx only
zanix new space my-app --pages=error,not-found    # both
```

```
src/space/routes/
  error.tsx       # app-wide error boundary (the outermost one — no route-path to scope it to yet)
  not-found.tsx   # the whole-app 404 view — always at the routes root, never nested
```

Omitting `--pages` entirely (the default) leaves a project relying on `@zanix/space`'s own
built-in fallback views for both — nothing breaks, there's just no project-owned file to edit yet.

Independent in the sense that matters most: none of `--template`/`--theme`/`--renderer`/`--icons`
ever gates WHETHER either file gets written, and `--pages` never touches any of their own output.
Their CONTENT does still compose with the other axes, same as `zanix generate error`/`not-found`
already do against an existing project: `--renderer` picks which `@zanix/space-ui` entrypoint
`error.tsx`'s `Button` (and, see below, its `IntlProvider`) imports; `--theme astronaut` picks
space-flavored copy for both files over the plain default. `--template population`/
`population-lang`, combined with `--pages` in the SAME `zanix new` call, adds one more real
composition: since that template already wrote `messages/` by the time `--pages` runs, both
generated files wrap their content in `IntlProvider`/`useIntl` instead of plain hardcoded English,
and their own catalog keys (`error/title`/`error/tryAgain`, `notFound/title`/
`notFound/description`) get seeded into every `messages/<lang>/index.json` the template wrote —
see [`generate-space.md`](./generate-space.md#error-boundary) for the full contract. Invalid
`--pages` values
(anything other than `error`/`not-found`) fail immediately, before anything is written, same as an
unknown `--theme`/`--renderer`.

## Library

`zanix new library [name]` writes two real, non-empty files, both generated locally (no
dependency on any other package's own content): a root `mod.ts` — the actual published entrypoint
(JSR's `exports['.']` convention) — that re-exports `src/modules/mod.ts`, a starter module with a
single example export to replace as the library grows. Neither imports any `@zanix/*` package (see
`PROJECT_TYPE_DEPENDENCIES`'s own `library: []` entry in `cli`'s source) — a library's whole point
is user-authored content, so this scaffold has no real shape to assume ahead of time the way
`server`'s example handler or `app`'s manifest can.

## Spacecraft

`zanix new spacecraft [name]` combines the **Space** and **Server** trees above
under the same `src/` — the file tree is their exact union, nothing merged or trimmed
(`newSpacecraftAction`, in `src/commands/new/actions/spacecraft.ts`, runs
`ensureServerScaffoldSideEffects` then `ensureSpaceScaffoldSideEffects` over the same
`structure.FOLDER`). Also accepts [`--renderer`](#--renderer), [`--icons`](#--icons),
[`--template welcome`](#--template-welcome), and [`--theme`](#--theme), applied
identically to its own `space.app.ts`/`deno.json`/`assets/`/`routes/page.tsx` — the server half of
a spacecraft project has no icon-catalog, landing-page, or visual-theme concept of its own, so none
of them ever touch `src/server/`.

### One process, two Applications

A spacecraft's `mod.ts` isn't just `space`'s `mod.ts` plus `server`'s stitched together — it's a
different composition, and the difference is the actual reason to reach for `spacecraft` instead of
either half alone:

- **Plain `space`**: `mod.ts` calls `bootstrapRemoteApp(spaceApp, getBootstrapSpaceAppConfig())`
  (from `@zanix/app/runtime`), never `Zanix.start()`. Exactly one Application runs in the process —
  the space app's own, named after `defineSpaceApp`'s own `name`. Auto-discovery of
  `.handler.ts`/`.interactor.ts`/`.connector.ts`/`.provider.ts`/`.defs.ts` files never runs at all,
  because that scan only ever happens inside `Zanix.start()`/`compose()`, which this entrypoint
  never calls.
- **Plain `server`**: `mod.ts` calls `Zanix.start()` with no `apps` option. One Application runs —
  the default one, `'main'` — and every handler/interactor/connector under the project root gets
  auto-discovered into it.
- **`spacecraft`**: `mod.ts` calls `Zanix.start({ apps: { [spaceApp.definition.name]: { definition:
  spaceApp, server: getBootstrapSpaceAppConfig().server } } })`. TWO Applications share the one
  process: `'main'`, populated the same way a plain `server` project's is (auto-discovered
  handlers/interactors/connectors under `src/server/`), and the space app's own named Application,
  activated as a registered app rather than served through `bootstrapRemoteApp` directly.
  Auto-discovery still only ever populates `'main'` — never the space app's own Application.

The comparison in full:

|                               | `space`                                                    | `server`                                | `spacecraft`                                                                                                |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `zanix.project` (`deno.json`) | `'space'`                                                  | `'server'`                              | `'space-server'`                                                                                            |
| `mod.ts` entry point          | `bootstrapRemoteApp(spaceApp, ...)`                        | `Zanix.start()`                         | `Zanix.start({ apps: {...} })`                                                                              |
| Applications in the process   | 1 — the space app's own                                    | 1 — `'main'`                            | 2 — `'main'` + the space app's own                                                                          |
| Auto-discovery                | never runs                                                 | populates `'main'`                      | populates `'main'` only — never the space app                                                               |
| `worker.ts`                   | absent                                                     | present                                 | present                                                                                                     |
| `deno task dev`               | `zanix space dev`                                          | `deno check && deno run --watch mod.ts` | `zanix space dev` — identical to plain `space`, and never starts or reloads `src/server/`                   |
| `deno task build`             | `zanix space build`                                        | absent                                  | `zanix space build`                                                                                         |
| `deno task worker`            | absent                                                     | `deno run worker.ts`                    | `deno run worker.ts`                                                                                        |
| Default REST/SSR config       | `{ ssr: {}, rest: {} }` via `getBootstrapSpaceAppConfig()` | inferred from discovered handlers       | both: `'main'` infers its own from `src/server/handlers/`, the space app still gets `{ ssr: {}, rest: {} }` |

`deno task dev`'s scope is worth restating plainly: even inside a `spacecraft` project, day-to-day
`zanix space dev` never touches `src/server/` — no watch, no reload, nothing. The server half only
starts, and only gets exercised, via `deno task start` (the real, production
`mod.ts`/`Zanix.start()` path) or `deno task worker`.

### `zanix generate` by project type

[`zanix generate`](./generate.md) also branches on project type, not just on which half of the tree
a file lands in:

| Generator                                                                                                                  | `space` | `server` | `space-server` | Lands in                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | :-----: | :------: | :------------: | --------------------------------------------------------------------- |
| `comet`, `component`, `page`, `layout`, `loading`, `error`, `not-found`, `graphql-schema`                                  |    ✓    |          |       ✓        | `src/space/...`                                                       |
| `handler`, `repository`, `rto`, `job`, `dlqprocessor`, `subscriber`, `middleware`, `globalmiddleware`, `openapi`, `seeder` |         |    ✓     |       ✓        | `src/server/...`                                                      |
| `connector`                                                                                                                |         |    ✓     |       ✓        | `src/server/connectors` (a hardcoded path, not derived from the tree) |
| `interactor`                                                                                                               |    ✓    |    ✓     |       ✓        | see below — the one generator with a genuinely different output shape |

`interactor` is the exception: a plain `space` project has no `src/server/` at all, so
`zanix generate interactor` there follows the real, already-proven `@zanix/console` convention
instead of the shared `server`/`space-server` folder — one folder per domain, named after the
interactor itself (`src/triggers/triggers.interactor.ts`), rather than
`src/server/interactors/<name>.interactor.ts`. It still runs
`ensureZanixDependency(root, '@zanix/server')` even in a plain `space` project, since
`ZanixInteractor` itself is exported from `@zanix/server`.

That interactor path is also the proof that DI genuinely works in a plain `space` project, not just
once wrapped in a `spacecraft`: `SpaceAppConfig.dependencies` forwards straight into
`defineZanixApp({ dependencies })` — the same generic mechanism any Zanix app uses — and
`@zanix/console` (a real, production `space` project with no `src/server/` of its own) proves it
end-to-end, with a hand-written `src/auth/login.interactor.ts` and a `mod.ts` that registers an
`'auth'` provider explicitly. What a plain `space` project doesn't get is scaffolding for the other
side of that DI graph: `zanix generate connector` is blocked there, so a connector in a pure `space`
project has to be hand-written against the same `ZanixConnector` base class `server`/`space-server`
generate automatically.

### Two composition gotchas

A standalone `@Resolver`/`@Controller` in a plain `space` project's own server config can register
successfully and still never be reachable. If a plain `space` project declares, say,
`server: { graphql: {...} }` via `defineBootstrapSpaceAppConfig`, remember that `bootstrapRemoteApp`
never runs auto-discovery — so anything not reached through `routesDir` or the space app's own
`setup()` (`defineSpaceApp({ setup })`) still registers under `'main'` by default, the same fallback
every Zanix artifact gets, but `bootstrapRemoteApp` only ever serves the space app's OWN
Application, never `'main'`. The result is silent: no error, no warning, just a resolver/controller
that's registered and never dispatched to. `@Page({ Interactor })` doesn't have this problem,
because pages load inside the same `setup()` scope the space app actually serves — any standalone
resolver/controller needs to be imported explicitly from that same `setup()` to be reachable at
all.

A freshly scaffolded `spacecraft` collides with itself on its first `deno task start`, before any
hand-editing. `'main'`'s example REST handler (`src/server/handlers/example.handler.ts`,
`@Controller`) and the space app's own default `rest: {}` config are both unanchored, and an
unanchored REST server's default `globalPrefix` is `'api'` regardless of which Application it
belongs to — so both default to port `8000`, prefix `'api'`. That's documented, expected behavior
for `@zanix/server` in general (an unanchored server colliding with another of the same type/prefix
on the same port — see `@zanix/server`'s own `docs/applications.md`, "Sharing a port with an
unanchored server"), but it's easy to hit by surprise on a `spacecraft` scaffold that hasn't
anchored either side yet. Anchor one side (`application: '<name>'`, `id: '<id>'`) or move it to a
different port before relying on both REST surfaces at once.

### Declaring `server: {...}` on a plain `space` doesn't make it a spacecraft

`defineBootstrapSpaceAppConfig({ server: { graphql: {...} } })` (or `rest`) is real — a plain
`space` project can genuinely serve GraphQL or REST of its own, no `spacecraft` required. It's
tempting to read that as "so a `space` can just grow into a `spacecraft` by adding config," but it
can't — it stays a single-Application project wearing an extra protocol, not a second, real
backend:

- Still exactly **one** Application (the space app's own) — never `'main'` plus a second one. A
  `spacecraft`'s whole point is having both, side by side, in the same process.
- Still **no auto-discovery** — every `@Resolver`/`@Controller` has to be reachable from
  `routesDir` or the space app's own `setup()` by hand (see the gotcha above), where `'main'`
  auto-discovers its entire `src/server/` tree for free.
- Still **no `worker.ts`** — a plain `space` project never gets `Zanix.startWorker()`, no matter
  what its `server:` config declares.
- Still **no server-side scaffolding** — `zanix generate connector`/`handler`/`repository`/`job`/
  etc. stay blocked (see the generator table above); anything beyond `interactor` has to be
  hand-written against the same base classes `server`/`space-server` generate automatically.
- Still **no build-time schema validation** for a GraphQL resolver defined this way. `zanix space
  build`'s GraphQL check (`@zanix/cli`'s own `graphql-check.ts`) only ever reaches
  `DEFAULT_APPLICATION` (`'main'`) — the same Application auto-discovery populates — because
  `@zanix/core`'s `Zanix.compose()` deliberately never activates a named, `apps`-scoped Application
  (it could carry real `dependencies`/`onStart` side effects — a live DB connection, an arbitrary
  hook — that a safe, side-effect-free static check has no business triggering). A `space`
  project's own resolver, reachable only through its own `apps`-scoped Application, is _always_ in
  that unreachable category — there's no configuration that gets it auto-discovered, because a
  plain `space` never runs auto-discovery at all (see above). A `spacecraft`'s `src/server/` tree
  doesn't have this problem: it's `'main'`, so it's exactly what the build-time check _can_ see. If
  a build-time guarantee that a query actually matches the schema matters, that alone is a reason
  to reach for `spacecraft` over a `space` with its own `server: {...}` — **and to put the resolver
  under `src/server/`, specifically.** A `spacecraft`'s own space half is still an `apps`-scoped
  Application like any other — the same blind spot applies to it too if a resolver is wired through
  the space app's own `setup()` instead of living in `src/server/`. `spacecraft` doesn't make the
  blind spot go away; it gives you a real place (`'main'`) to keep a resolver out of it.

In short: `server: {...}` on a `space` app is for exposing a _small, self-contained_ API alongside
the frontend (think: one resolver backing the space's own data needs), not for building out a real
backend. The moment that grows into something with its own handlers/interactors/connectors/jobs
worth generating and auto-discovering, that's the signal to reach for `spacecraft` instead — not to
keep piling config onto a plain `space`.

### Which one to reach for

Nothing in `zanix new` itself enforces a rule here — it scaffolds any of the three regardless of
what's being built. The real-world convention is `@zanix/console`, a production `space` project
with no `src/server/` of its own: reach for plain `space` when the frontend owns no data of its own
and talks to a remote, already-existing Zanix API. Reach for `spacecraft` when the frontend and its
own backend deploy together, as a single process/repo.

## `--no-prepare`

By default, `zanix new` finishes by running the equivalent of
`zanix prepare <name> --project-type=<type>
-g -e` for you — Git init, hooks, CI
workflow, and VS Code config, all in one step. Pass `--no-prepare` to skip that
and run [`zanix prepare`](./prepare.md) yourself later, with your own flags.

## `--verify`

Opt-in — `zanix new` stays 100% local and instant by default, with no network
dependency. Pass `--verify` to additionally run `deno check` against every file
in the new project once it's written, against whatever `@zanix/*` dependency
versions are actually resolvable right now:

```bash
zanix new server my-api --verify
```

A failure only ever warns — it never changes `zanix new`'s own exit code —
because the generated code is still correct against `cli`'s own known API shape;
a `--verify` failure means an upstream Zanix package changed in a way that broke
it (or hasn't published a version yet), not that generation itself failed. This
is the same check this project's own CI runs on a schedule against every
project type — `--verify` just runs it on-demand, scoped to the one project you
just created.

## See also

- [`generate`](./generate.md) — add artifacts to the project `new` just created.
- [`build`](./build.md) — compile/obfuscate the project.
- [`prepare`](./prepare.md) — what the automatic post-scaffold step actually
  runs.
- [`deploy.md`](./deploy.md) — running the generated `start`/`worker` tasks in
  production.
