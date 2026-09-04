# `zanix space` — `@zanix/space` dev server and client build

`zanix space <dev|build>` is the tooling counterpart to a scaffolded `@zanix/space` frontend
project (`zanix new space`/`zanix new spacecraft`) — running it locally with real HMR, and
building its real, production client bundle. Both subcommands import the project's own
`space.app.ts` manifest directly (never `mod.ts`, which would also call
`activateApps()`/`bootstrapServers()` and start a second, unaware production boot) — see each
subcommand's own section below. Running `zanix space` with no subcommand errors out.

```bash
zanix space <dev|build>
```

| Subcommand   | Command             | Options                                                                                | Does                                                             |
| ------------ | ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Dev server   | `zanix space dev`   | `-p, --port <port>` (default `20202`), `--no-graphql-check`                            | Runs the project with real file-watching HMR — see [below](#dev) |
| Client build | `zanix space build` | `--out-dir <dir>`, `--no-minify`, `--obfuscate`, `--no-messages`, `--no-graphql-check` | Builds the real, production client bundle — see [below](#build)  |

## Dev

```bash
zanix space dev
zanix space dev --port 3000
```

Runs a `@zanix/space` project in dev mode: real file-watching HMR (SSR module invalidation,
browser-facing asset transform, automatic reload) — never a substitute for
[`zanix build`](./build.md)/the project's own `start` task in production. `--port` defaults to
`20202` (`@zanix/server`'s own static port default for an `'ssr'` server); the same port also
serves the dev-only WebSocket connection the browser uses to receive HMR updates, so there's only
ever one port to open, same-origin.

Only valid inside a `space`/`space-server` project — errors out otherwise. Also runs the
[GraphQL check](#graphql-check) once at boot (`--no-graphql-check` opts out); unlike a build, a
failure there is only reported, never fatal — dev keeps running.

## Build

```bash
zanix space build
zanix space build --obfuscate --out-dir dist/production-client
```

Builds this `@zanix/space` project's real, production CLIENT bundle: comets (each its own hashed
chunk), CSS, and their manifests — **never** the SSR/server side, which keeps running directly
against source via the project's own `start` task (Deno executes `.tsx` natively; no bundle is
needed for that to work, the same way `zanix space dev` already runs it, just without HMR).

| Option                         | Default          | Description                                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--out-dir <dir>`              | `'.dist/client'` | Client output directory, relative to the project root.                                                                                                                                                                                                       |
| `--no-minify`                  | (minifies)       | Skip minification of the built output.                                                                                                                                                                                                                       |
| `--obfuscate`                  | `false`          | Obfuscate every built `.js` file (each comet chunk, and `sw.js` if a PWA is configured) — the same shared obfuscation config [`zanix build`](./build.md#zanix-build--compile-and-obfuscate)'s own `--obfuscate` uses, not a second, independently-tuned one. |
| `--no-messages`                | (compiles)       | Skip compiling `defineSpaceApp({ messagesDir })` ICU catalogs to AST. Has no effect when `messagesDir` isn't configured.                                                                                                                                     |
| `--no-graphql-check`           | (checks)         | Skip the GraphQL query/mutation check — see [GraphQL check](#graphql-check). Has no effect when the project has no `gql/` directory.                                                                                                                         |
| `--validation [mode]`          | `static`         | Document validation to run — see [Document validation](#document-validation).                                                                                                                                                                                |
| `--no-validation`              | (validates)      | Skip document validation entirely.                                                                                                                                                                                                                           |
| `--validation-strict`          | `false`          | Treat every active warning as an error, failing the build.                                                                                                                                                                                                   |
| `--validation-category <list>` | (all)            | Restrict validation to these categories, comma-separated.                                                                                                                                                                                                    |

Reads back the project's own `space.app.ts` declarations (`globalCss`, `pwa`) automatically —
nothing needs to be passed on the command line for either. The renderer (`react`/`preact`,
[`zanix new`'s own `--renderer`](./new.md#--renderer)) is picked up the same way, with zero
renderer-specific code in this command itself.

A project with no comets, no declared `globalCss`, and no PWA configured is a
valid (if unusual) app state — a page whose entire UI renders server-side with
nothing client-facing at all — not an error; `--obfuscate` on that kind of
project is simply a no-op, since there's no `.js` output to obfuscate.

## How `space.app.ts` (and a page, or a GraphQL client/query file) gets its own dependencies

Both `zanix space dev` and `zanix space build` dynamically import this project's own
`space.app.ts`; every discovered page/layout's own module, during ordinary page discovery (which
runs on every invocation, not only under `--validation=render` — that flag additionally imports
each page again for the render probe); and, when a `gql/` directory exists, every `**/*.client.ts`
GraphQL client and `gql/**/*.gql.ts` query module — from CLI-owned code. Every one of these resolves
its own bare specifiers against **this project's
own nearest `deno.json`/`deno.jsonc`**, including a `"links"` override this project declares (the
standard way to test an unpublished local checkout of a dependency before it publishes) — this
holds regardless of whether `@zanix/cli` itself is a normal `jsr:@zanix/cli` install or run from a
**local checkout** (e.g. `deno run -A ../cli/mod.ts space dev`, while developing `@zanix/cli` or
one of its dependencies).

The one deliberate exception: a package `@zanix/cli` ITSELF also depends on for its own
orchestration (`@zanix/space`, `@zanix/app`, `@zanix/server`) always resolves through
`@zanix/cli`'s own configuration instead, whatever this project declares for it — these packages
share real, module-level state (a renderer registry, a route registry) between `@zanix/cli`'s own
code and whatever `space.app.ts` imports, so both sides need the exact same module instance. In
practice this only matters if this project's own declared version for one of them genuinely
diverges from what `@zanix/cli` itself depends on — the normal case, where `zanix new` scaffolds a
project's own dependency from the same source `@zanix/cli` uses internally, is unaffected.

## GraphQL check

Both `zanix space dev` and `zanix space build` check every `gql/**/*.gql.ts` file under the
project's `gql/` directory (`@zanix/space`'s own `docs/data-fetching.md` convention) before the
real build/dev boot runs — on by default whenever a `gql/` directory exists, a no-op otherwise.
`--no-graphql-check` opts out either way.

Two layers, run in order:

- **Syntax** — every exported string in every `gql/**/*.gql.ts` file is parsed with `graphql-js`'s
  own `parse()`, independent of whether any local GraphQL server exists. Isolated per file/export:
  one broken query never hides the rest of the run's findings.
- **Schema match** — for a client discovered under `gql/**/*.client.ts` whose `schemaApplication`
  names a local Application (or leaves it unset, the project's own default), its queries are
  validated against that Application's real, locally compiled schema (a `deno run` subprocess that
  statically introspects the project — the same technique `zanix generate openapi` uses for REST
  routes, never a running server). A client whose `schemaApplication` is the literal string
  `'external'` is syntax-only, deliberately never schema-checked. A client whose
  `schemaApplication` is `{ external: true }` is checked against a cached copy of ITS real,
  external schema instead — `gql/<name>.schema.graphql`, written by
  [`zanix generate graphql-schema`](./generate.md#graphql-schema-cache); a missing cache is a
  warning (run the generator), not a build failure.

`zanix space build` fails the build on a real syntax/schema failure — before the slow Vite build
ever starts, the same fail-fast timing message compilation already uses. `zanix space dev` only
reports failures and warnings; it never stops the dev server over them.

## Document validation

Both `zanix space dev` and `zanix space build` check the documents this project produces, using the
same flags with the same meaning in each. Findings are reported; only an `error` fails a build.

```bash
zanix space build                              # static validation (the default)
zanix space build --validation-strict          # every active warning becomes an error
zanix space build --no-validation              # skip it entirely
zanix space build --validation-category html,a11y
zanix space dev --validation=render            # adds the render phase (dev only, see below)
```

### The flags

| Flag                           | Meaning                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--validation`                 | Runs the static phase. This is the default, so passing it changes nothing.                                                                                                                                                                                                            |
| `--validation=render`          | **Adds** the render phase on top of the static one. It never replaces it: the render phase covers a subset of routes and a subset of rules, so treating it as an alternative would reduce coverage while reading like an increase.                                                    |
| `--no-validation`              | Skips validation entirely. Wins over every other validation flag.                                                                                                                                                                                                                     |
| `--validation-strict`          | Promotes every **active** warning to an error. It does not promote `info` findings, and it does not switch on rules the project has not enabled — strict is about how seriously findings are taken, never about which rules run.                                                      |
| `--validation-category <list>` | Restricts the run to `html`, `seo`, `a11y`, `social`, `pwa` or `framework`. Narrowing the run never changes the severity of what remains. An unknown category is an error, not a silent no-op: a typo that matched nothing would otherwise report a clean run over an empty rule set. |

### Why `--validation=render` does not run during a build

`zanix space build` accepts the flag and reports the render phase as _not run_, with the reason.
That is deliberate. A build imports the project's `space.app.ts` to read what it declared, but never
activates the app — so no routes are loaded, and for a `renderer: 'preact'` project the Preact page
renderer is never registered. Probing under those conditions would render every page with the wrong
renderer and report confident findings about a document the app will never serve.

`zanix space dev` activates the app, so the route tree and the configured renderer are both real by
the time validation runs. That is where the render phase belongs:

```bash
zanix space dev --validation=render
```

### Reading the output

Findings are grouped most-severe-first, each with a rule code, what is wrong, and where:

```
warn   DOC001  Route 'products' resolves no <title>.  (routes/products/page.tsx · route 'products')
       Declare `static head = { title: ... }` on the page, or a `head` export on a layout in its chain.
```

A run also reports what it could **not** check, under `Not checked`. This matters as much as the
findings themselves: a validator that silently skips work reads exactly like one that found nothing
wrong. Typical entries are routes whose `head` depends on loader data (which does not exist at build
time), sitemap cross-checks when the project declares its sitemap as a function, and — in a build —
the render phase.

### Project-level configuration

Flags shape a single run. Policy that belongs to the project lives in `space.app.ts`, versioned with
it:

```ts
export default defineSpaceApp({
  name: 'storefront',
  validation: {
    strict: true,
    rules: { SEO002: true, A11Y007: 'info', SEO001: false },
    exempt: ['internal/**'],
  },
})
```

- `rules` both **activates** and **sets severity**. A rule that is off by default is switched on
  with `true` (keeping its own severity) or with an explicit severity. `false` switches one off.
- `exempt` excludes route patterns from document rules — `*` matches within a segment, `**` across
  segments.
- `validation: false` disables it for the project. No flag re-enables it.

Flags win field by field over this config, but there is deliberately **no flag** for `rules` or
`exempt`: per-rule severity and route exemptions are decisions that should live in the repository,
not be retyped on a command line.

For what the rules actually are, what each one rests on, and which of them can never be decided at
build time, see `@zanix/space`'s own documentation.

## See also

- [`new`](./new.md) — scaffolds the `space`/`spacecraft` project this tooling runs against.
- [`build`](./build.md) — `zanix build`, for the project's own backend/server code; `zanix space
  build` only ever handles the frontend client bundle.
- [`prepare`](./prepare.md) — `--docker -p space`/`-p space-server` calls `zanix space build`
  automatically as part of the generated Dockerfile's build stage.
- [`deploy.md`](./deploy.md) — running `zanix space build` before the first `start` on a bare Deno
  host/VM.
