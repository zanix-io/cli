# `zanix generate` — frontend artifacts (`@zanix/space`)

The 7 frontend artifacts `zanix generate <artifact> <name> [root]` can add to
an **already-existing** `space`/`space-server` project. See
[`generate.md`](./generate.md) for the command's shared behavior (never
overwrites an existing file, the optional trailing `root` argument,
[`--verify`](./generate.md#--verify)) and every **backend** artifact
(`server`/`space-server` projects).

| Artifact         | Command                               | Creates                                                            |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Comet            | `zanix generate comet <name>`         | `comets/<name>.comet.tsx` — see [below](#comet)                    |
| Component        | `zanix generate component <name>`     | `components/<name>.tsx` — see [below](#component)                  |
| Page             | `zanix generate page <route-path>`    | `routes/<route-path>/page.tsx` — see [below](#page)                |
| Layout           | `zanix generate layout <route-path>`  | `routes/<route-path>/layout.tsx` — see [below](#layout)            |
| Error boundary   | `zanix generate error <route-path>`   | `routes/<route-path>/error.tsx` — see [below](#error-boundary)     |
| Loading fallback | `zanix generate loading <route-path>` | `routes/<route-path>/loading.tsx` — see [below](#loading-fallback) |
| Not-found view   | `zanix generate not-found [root]`     | `routes/not-found.tsx` — see [below](#not-found-view)              |

Every artifact above generates relative to `src/space/` in the target project
(e.g. `comets/<name>.comet.tsx` really means `src/space/comets/<name>.comet.tsx`)
— the `@zanix/space` convention, not `server/`'s. Unlike every other artifact
on this page, `not-found` takes no `<name>`/`<route-path>` argument at all —
it's a single, whole-app file, always written at the routes root (see
[below](#not-found-view)).

These are the exact same template functions `zanix new space`/`zanix new spacecraft`
call to seed their own example files — there is one source of truth for each
artifact's shape, not a separately hand-maintained copy (see
[`new`](./new.md)). `component` is the one exception: it has no `zanix new`
scaffold leaf yet (see [below](#component) for why), so `planComponent` is
only ever called by `zanix generate component` itself today.

## Comet

```bash
zanix generate comet counter
```

Creates `comets/counter.comet.tsx` — a selective-hydration Comet shell, matching
`@zanix/space`'s own `defineComet` contract exactly:

```tsx
'use comet'

import { defineComet } from '@zanix/space/comet'

export function Counter() {
  return <div>Counter</div>
}

export default defineComet(Counter, import.meta.url)
```

The `'use comet'` directive (how `cometPlugin` finds this file at build time),
the exported function name (`defineComet` needs it to re-import the component
after the client build), and `import.meta.url` as the second argument are all
required — never edit those three pieces away.

## Component

```bash
zanix generate component product-card
```

Creates `components/product-card.tsx` — a plain, presentational component,
server-rendered like any other JSX in the page tree (no `'use comet'`, no
`defineComet`, no hydration of its own):

```tsx
export default function ProductCard() {
  return <div>ProductCard</div>
}
```

Meant to be imported by hand into a `page.tsx`/`layout.tsx`/another
component's own JSX tree — `@zanix/space`'s own README shows exactly this
composition (`component = ProductView`). Presentational in the same sense
`@zanix/space-ui` documents for its own component library ("presents data,
never owns it"): no fetch, no router/history call, no form submission state
belongs in what this generator writes — wire those in from the page/loader
that owns them instead.

Unlike every other artifact on this page, `component` is never discovered by
its file location — `@zanix/space` has no `components/` routing convention to
hook into; `components/` is simply the scaffolding location this generator
picks, the same role `comets/` plays for Comet shells. It's also not seeded by
`zanix new space`/`zanix new spacecraft` today: `@zanix/utils`'s own published
`ZanixSpaceSrcTree` type only declares `routes`/`comets` subfolders, so there
is no typed tree leaf yet for a fresh project's scaffold to target (same
reason `zanix generate middleware` isn't seeded by `zanix new server` either
— see [`generate.md`](./generate.md#middleware)). `zanix generate component`
still works the same way on any already-scaffolded project.

## Page

```bash
zanix generate page products
zanix generate page 'products/[id]'
```

Creates `routes/<route-path>/page.tsx` — a file-based page, registered on
`@zanix/space`'s `'ssr'` handler type via `@Page()` (no argument: the route is
inferred from this file's own location, exactly where this command writes it).
The route path is written verbatim as the folder structure, dynamic segments
(`[id]`) included — only the generated class/function names are derived from it,
as a starting point:

```tsx
import { Page, SpacePageController } from '@zanix/space'

function ProductsView() {
  return (
    <main>
      <h1>Products</h1>
    </main>
  )
}

@Page()
export default class ProductsPage extends SpacePageController {
  public static override head = { title: 'Products' }

  public override component = ProductsView
}
```

`head`/`component` carry explicit `public` modifiers (the generated project's
own `deno-zanix-plugin/require-access-modifier` lint rule has no auto-fix) —
`head` also needs `override` (a concrete, non-abstract member on
`SpacePageController`, so `strict: true` rejects overriding it without the
keyword); `component` implements an `abstract` member (never required to
carry `override`) but keeps it too, matching `@zanix/space`'s own real page
fixtures.

Add `loader`/`action` by hand once the page needs data or handles a form
submission — see `@zanix/space`'s own README for the full `SpacePageController`
contract.

## Layout

```bash
zanix generate layout products
```

Creates `routes/<route-path>/layout.tsx` — a plain default-exported function
component wrapping every page (and nested layout) under that route segment,
discovered purely by file location:

```tsx
import type { LayoutProps } from '@zanix/space'

export default function ProductsLayout({ children }: LayoutProps) {
  return <div>{children}</div>
}
```

## Error boundary

```bash
zanix generate error products
```

Creates `routes/<route-path>/error.tsx` — a plain default-exported function
component catching any error thrown while rendering that route segment (or a
nested one), discovered purely by file location, same convention as `layout`:

```tsx
import type { ErrorBoundaryProps } from '@zanix/space'
import { Button } from '@zanix/space-ui'

export default function ProductsError({ error, reset }: ErrorBoundaryProps) {
  return (
    <div data-space='error'>
      <p>Something went wrong:</p>
      <p>{String(error)}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
```

**If the project already has a `messages/` directory** (e.g. scaffolded via
`zanix new space --template population`/`population-lang`), the generated file
wraps its content in `IntlProvider`/`useIntl` instead, reading
`ErrorBoundaryProps.messages` (never calling `loadMessages` itself — it's
already resolved by the time `error.tsx` runs) and seeds the two catalog keys
it reads (`error/title`, `error/tryAgain`) into every discovered lang's own
`messages/<lang>/index.json` — only adding a key that isn't already there,
never overwriting a customized value:

```tsx
import type { ErrorBoundaryProps } from '@zanix/space'
import { Button, IntlProvider, useIntl } from '@zanix/space-ui'
import type { Messages } from '@zanix/space-ui'

function ProductsErrorContent({ error, reset }: Pick<ErrorBoundaryProps, 'error' | 'reset'>) {
  const { formatMessage } = useIntl()
  return (
    <div data-space='error'>
      <p>{formatMessage('error/title')}</p>
      <p>{String(error)}</p>
      <Button onClick={reset}>{formatMessage('error/tryAgain')}</Button>
    </div>
  )
}

export default function ProductsError({ error, reset, params, messages }: ErrorBoundaryProps) {
  return (
    <IntlProvider locale={params.lang ?? 'en'} messages={(messages ?? {}) as Messages}>
      <ProductsErrorContent error={error} reset={reset} />
    </IntlProvider>
  )
}
```

See [`@zanix/space`'s own `docs/i18n.md`](https://github.com/zanix-io/space/blob/master/docs/i18n.md#error-and-not-found-pages)
for the full `ErrorBoundaryProps.messages` contract.

## Loading fallback

```bash
zanix generate loading products
```

Creates `routes/<route-path>/loading.tsx` — a plain, no-props, default-exported
function component shown while that route segment suspends, discovered purely
by file location, same convention as `layout`/`error`:

```tsx
export default function ProductsLoading() {
  return <p>Loading...</p>
}
```

React-only: a project using `defineSpaceApp({ renderer: 'preact' })` rejects any
`loading.tsx` at route-registration time (Preact core has no `Suspense`) — see
`@zanix/space`'s own README for the full renderer contract.

## Not-found view

```bash
zanix generate not-found
```

Creates `routes/not-found.tsx` — unlike every other artifact on this page, a
single, whole-app file, always written at the routes root, never under a
`<route-path>` (the first directory in `routesDir` to declare one wins,
app-wide). Falls back to `@zanix/space`'s own built-in default view if never
generated:

```tsx
export const head = { title: 'Page not found' }

export default function NotFound() {
  return <h1 data-space='not-found'>404 — Page not found</h1>
}
```

`head` is a named export, never an inline `<title>` inside the component's own
JSX — `head` is always static (read once, at route-registration time), so it
can't reflect a resolved `lang` the way the body below can.

**If the project already has a `messages/` directory**, the generated file
wraps its visible content (never `head`'s own `<title>`) in `IntlProvider`/
`useIntl` instead, reading `NotFoundProps.lang`/`messages` — both resolve
lazily, only once a 404 is already confirmed — and seeds `notFound/title`/
`notFound/description` into every discovered lang's own catalog, same
never-overwrite merge `error.tsx` above uses:

```tsx
import type { NotFoundProps } from '@zanix/space'
import { IntlProvider, useIntl } from '@zanix/space-ui'
import type { Messages } from '@zanix/space-ui'

function NotFoundContent() {
  const { formatMessage } = useIntl()
  return (
    <div data-space='not-found'>
      <h1>{formatMessage('notFound/title')}</h1>
      <p>{formatMessage('notFound/description')}</p>
    </div>
  )
}

export const head = { title: 'Page not found' }

export default function NotFound({ lang, messages }: NotFoundProps) {
  return (
    <IntlProvider locale={lang ?? 'en'} messages={(messages ?? {}) as Messages}>
      <NotFoundContent />
    </IntlProvider>
  )
}
```

See [`@zanix/space`'s own `docs/i18n.md`](https://github.com/zanix-io/space/blob/master/docs/i18n.md#error-and-not-found-pages)
for the full `NotFoundProps.messages` contract.

## See also

- [`generate.md`](./generate.md) — the command's shared behavior, every
  backend artifact, [`--verify`](./generate.md#--verify), and
  [`graphql-schema`](./generate.md#graphql-schema-cache) — a
  `space`/`space-server`-only generator documented there instead of here,
  alongside `openapi`, since it's a discovery/cache tool rather than a
  `zanix new`-mirrored template leaf.
- [`new`](./new.md) — bootstraps a whole project, seeding it with example files
  generated by these same template functions.
- [`space`](./space.md) — run the resulting `@zanix/space` project in dev mode,
  or build its production client bundle.
