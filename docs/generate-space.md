# `zanix generate` — frontend artifacts (`@zanix/space`)

The 6 frontend artifacts `zanix generate <artifact> <name> [root]` can add to
an **already-existing** `space`/`space-server` project. See
[`generate.md`](./generate.md) for the command's shared behavior (never
overwrites an existing file, the optional trailing `root` argument,
[`--verify`](./generate.md#--verify)) and every **backend** artifact
(`server`/`space-server` projects).

| Artifact         | Command                               | Creates                                                            |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Comet            | `zanix generate comet <name>`         | `comets/<name>.comet.tsx` — see [below](#comet)                    |
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
[`new`](./new.md)).

## Comet

```bash
zanix generate comet counter
```

Creates `comets/counter.comet.tsx` — a selective-hydration Comet shell, matching
`@zanix/space`'s own `defineComet` contract exactly:

```tsx
'use comet'

import { defineComet } from '@zanix/space'

export function Counter() {
  return <div>Counter</div>
}

export default defineComet(Counter, import.meta.url)
```

The `'use comet'` directive (how `cometPlugin` finds this file at build time),
the exported function name (`defineComet` needs it to re-import the component
after the client build), and `import.meta.url` as the second argument are all
required — never edit those three pieces away.

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
  return <p>Products</p>
}

@Page()
export default class ProductsPage extends SpacePageController {
  component = ProductsView
}
```

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

export default function ProductsError({ error, reset }: ErrorBoundaryProps) {
  return (
    <div>
      <p>Something went wrong: {String(error)}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

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
export default function NotFound() {
  return (
    <>
      <title>Page not found</title>
      <h1>404 — Page not found</h1>
    </>
  )
}
```

## See also

- [`generate.md`](./generate.md) — the command's shared behavior, every
  backend artifact, and [`--verify`](./generate.md#--verify).
- [`new`](./new.md) — bootstraps a whole project, seeding it with example files
  generated by these same template functions.
- [`space`](./space.md) — run the resulting `@zanix/space` project in dev mode,
  or build its production client bundle.
