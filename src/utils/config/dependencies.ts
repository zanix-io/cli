import type { ZanixProjects } from '@zanix/types'

import { getConfigDir, readConfig, saveConfig } from '@zanix/helpers'

/**
 * The single source of truth for which import specifier `cli` writes for each Zanix package it can
 * declare in a generated project's `deno.json`. Bumping a compatible version for any Zanix
 * dependency means editing exactly one line here — nothing else in `cli` (templates, generators,
 * `zanix new`/`zanix generate`) hardcodes a version of its own.
 *
 * `@zanix/validator` isn't a published package — every sibling Zanix repo (`server`, `datamaster`,
 * `auth`, `core`, `admin`) declares it as an import alias into `@zanix/utils`'s own `/validator`
 * subpath; the value here follows that same, already-established convention.
 *
 * `@zanix/app`/`@zanix/space` are real, published JSR packages (verified directly against
 * `https://jsr.io/@zanix/app/meta.json` and `https://jsr.io/@zanix/space/meta.json`) — a freshly
 * generated `app`/`space` project's `deno check`/`deno add` resolves them for real, no publishing
 * gap here.
 *
 * `@zanix/server/graphql` and `@zanix/asyncmq/jobs` below each pin a floor (`^4.1.0`/`^0.8.0`
 * respectively) that carries the subpath a freshly generated `graphql` handler/job file needs —
 * `ZanixResolver`/`Resolver`/`Query`/`Mutation`/`Request` and `registerJob`/`registerCronJob`
 * are not re-exported from either package's bare root. Both floors are real and published
 * (verified against `https://jsr.io/@zanix/server/meta.json` and
 * `https://jsr.io/@zanix/asyncmq/meta.json`) — `deno.jsonc`'s own `imports` map resolves both
 * directly to JSR, no local override needed for either.
 */
export const ZANIX_DEPENDENCY_VERSIONS = {
  '@zanix/server': 'jsr:@zanix/server@^4.2.1',
  // A separate import-map key, not covered by the bare '@zanix/server' entry above — same
  // convention `@zanix/validator`/`@zanix/app/runtime` already use for a subpath of a different
  // package. `zanix generate handler --type graphql`'s resolver imports `ZanixResolver`/
  // `Resolver`/`Query`/`Mutation`/`Request` from here — `@zanix/server`'s root barrel no longer
  // exports them as of `4.0.0`, the first published version carrying this subpath (verified
  // against `https://jsr.io/@zanix/server/meta.json`, currently at `4.2.1`).
  '@zanix/server/graphql': 'jsr:@zanix/server@^4.2.1/graphql',
  // `^1.5.0` was the first published `@zanix/datamaster` carrying the unified `SEARCH_ENGINE`
  // selector (replacing separate `ELASTICSEARCH_URL`/`OPENSEARCH_URL`/`MEILISEARCH_URL` presence
  // checks), required by `@zanix/core`'s own logger auto-detect since that package's `^2.0.0` —
  // the `@zanix/core`/`@zanix/datamaster` floors below have each since moved past both of those,
  // see each entry's own comment for the current reason.
  '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.1',
  '@zanix/asyncmq': 'jsr:@zanix/asyncmq@^0.8.0',
  // A separate import-map key, not covered by the bare '@zanix/asyncmq' entry above — same
  // convention `@zanix/server/graphql` already uses for a subpath of a different package.
  // `zanix generate job`'s generated job file, and `zanix new server`/`space-server`'s seeded
  // `example-job.defs.ts`, both import `registerJob`/`registerCronJob` from here — `@zanix/asyncmq`'s
  // bare root re-exports neither as of `0.8.0`, the first published version carrying this subpath
  // (verified against `https://jsr.io/@zanix/asyncmq/meta.json`, currently `latest`).
  '@zanix/asyncmq/jobs': 'jsr:@zanix/asyncmq@^0.8.0/jobs',
  // `@zanix/utils@3.0.1` was the first published version with `classMetadata` (class-level RTO
  // metadata introspection, no instance/payload needed) — required by `zanix generate openapi`'s
  // discovery step. The floor below has since moved past that major, to `4.2.1` — real and
  // published (verified against `https://jsr.io/@zanix/utils/meta.json`, currently `latest`).
  '@zanix/validator': 'jsr:@zanix/utils@^4.2.1/validator',
  // Same alias convention as `@zanix/validator` above. Not referenced by
  // `PROJECT_TYPE_DEPENDENCIES` today — no currently-generated output imports
  // `@zanix/types` — kept here regardless: a real, valid alias into
  // `@zanix/utils`'s own `/types` subpath, ready the moment a future field
  // type or generator needs it again. Pinned to the same major floor as `@zanix/validator`
  // above — same underlying package, no reason for this one to sit on a stale major.
  '@zanix/types': 'jsr:@zanix/utils@^4.2.1/types',
  // `@zanix/core@2.0.0` moved `ConfigOptions.errorLogThrottle` under
  // `ConfigOptions.errors.logThrottle`, and `setup()`'s logger auto-detect/
  // `ConfigOptions.notifications` now follow `@zanix/datamaster`/`@zanix/notifications`'s own
  // selector-based env-var renames (`SEARCH_ENGINE`, `notifications.templatesBackend`) — no
  // dual-read compat shim on either side, so `@zanix/datamaster` above pins its own matching
  // floor: the first published version carrying its half of the same rename.
  // `cli` itself never emits `errorLogThrottle`/`ELASTICSEARCH_URL`/`OPENSEARCH_URL`/
  // `databaseTemplates` in any generated template — nothing else here needs to change as either
  // floor moves further ahead.
  '@zanix/core': 'jsr:@zanix/core@^3.1.1',
  // `defineZanixApp`/`ZanixAppDefinition` (the two exports the generated `app` `mod.ts` uses)
  // carry no breaking change across the range this floor has moved through so far, so bumping
  // this is a plain version bump, not a compat concern — re-verify against `@zanix/app`'s own
  // CHANGELOG before assuming that stays true for a future major.
  '@zanix/app': 'jsr:@zanix/app@^1.0.2',
  // A separate import-map key, not covered by the bare '@zanix/app' entry above — same convention
  // '@zanix/validator' already uses for a subpath of a different package. A pure `space` project's
  // entrypoint imports `bootstrapRemoteApp` from here directly (never `@zanix/core`, see
  // `getSpaceModTemplate`'s own doc in `cli`), so this needs its own declared specifier.
  '@zanix/app/runtime': 'jsr:@zanix/app@^1.0.2/runtime',
  // Real, confirmed reason to keep this floor in lockstep with `cli`'s OWN `deno.jsonc` entry for
  // the same package (`imports["@zanix/space"]`), not just "the latest version" for its own sake:
  // `zanix space dev`/`build` resolves `@zanix/space` bare imports through `cli`'s OWN config
  // (`import-project-module.ts`'s `resolveReplacement`, the identity-sharing mechanism its own doc
  // covers in full) — a scaffolded project pinned to an OLDER floor here than what `cli` itself
  // resolves internally is exactly the shape that let two different `@zanix/space` versions load
  // as two separate module instances in the same process (confirmed live: `@zanix/space` publishing
  // a newer version mid-session, with this entry left stale, split `SpaceDevSocket` identity and
  // threw "already defined" on its own dev-socket route). Bump this ALONGSIDE `cli`'s own
  // `deno.jsonc` entry, never independently.
  '@zanix/space': 'jsr:@zanix/space@^1.3.0',
  // Real, published JSR package as of `0.1.0` (verified directly against
  // `https://jsr.io/@zanix/space-ui/meta.json`) — `resolveSpaceUiVersion` (`commands/new/lib/tree/
  // projects/space-icons.ts`) reads this entry to resolve which published version `--icons`
  // fetches its scaffold icon catalog from; that function needs no change of its own now that this
  // entry exists, by design (see its own doc).
  '@zanix/space-ui': 'jsr:@zanix/space-ui@^1.0.0',
  // Same subpath-alias convention as `@zanix/validator`/`@zanix/types` above (both real `@zanix/
  // utils` subpaths, pinned to the same floor as those two rather than the bare package's own
  // caret range) — `app`'s generated `mod.ts` (`getAppModTemplate`) imports the real Zanix
  // `logger` instead of `console` (required by `no-znx-console`, whose auto-fix has been
  // published in `@zanix/utils` since `3.0.0` — the floor below already carries it), so this
  // needs its own declared specifier the same way `@zanix/app/runtime` does for a different
  // package.
  '@zanix/utils/logger': 'jsr:@zanix/utils@^4.2.1/logger',
  '@zanix/utils/linter': 'jsr:@zanix/utils@^4.2.1/linter/deno-zanix-plugin',
} as const satisfies Record<string, string>

/**
 * Same single-source-of-truth reasoning as `ZANIX_DEPENDENCY_VERSIONS`, kept as its own table for
 * every non-`@zanix/*` (npm/jsr third-party) version `cli` ever writes into a generated project's
 * `deno.json` — a version like `react`'s below is exactly as easy to let drift as a `@zanix/*` one
 * if it's left inline at its call site instead of centralized here.
 */
export const THIRD_PARTY_DEPENDENCY_VERSIONS = {
  // `base.ts` writes this for `space`/`space-server` under `--renderer=react` (the default) —
  // `jsxImportSource: 'react'` means every `.tsx` file has an implicit `react/jsx-runtime` import.
  // Same version `@zanix/space`'s own `deno.json` pins.
  react: 'npm:react@^19.2.0',
  // `base.ts` writes THIS instead, in place of `react` above, under `--renderer=preact` — same
  // reasoning, `jsxImportSource: 'preact'` instead. Same version `@zanix/space`'s own `deno.json`
  // pins. Never both at once — `--renderer` selects the whole project's renderer, never a hybrid.
  preact: 'npm:preact@^10.29.0',
  // `base.ts` writes this ALONGSIDE `preact` above, unconditionally, same `renderer === 'preact'`
  // gate — Deno's own import-map resolution requires every USED npm subpath declared explicitly
  // (unlike Node's own `require('pkg/sub')`, which resolves any subpath automatically once the
  // base package exists on disk); omitting this here breaks `--theme astronaut`'s own comet demo
  // (`getHooksEntry(renderer)`, `lib/renderer.ts`) — which imports `useState` from `preact/hooks`
  // under this renderer — with "not a dependency and not in import map" whenever a
  // `--renderer preact --theme astronaut` scaffold runs. Declared
  // unconditionally rather than gated on `--theme` too, matching this same file's own
  // `babel-plugin-react-compiler` precedent just below (declared for every `react` renderer,
  // regardless of `--template`/`--theme`) — a declared-but-unused import map entry is harmless; a
  // missing one is a hard failure the moment anything needs it.
  'preact/hooks': 'npm:preact@^10.29.0/hooks',
  // `base.ts` writes this for `space`/`space-server` ONLY under `--renderer=react` (React
  // Compiler has no Preact equivalent) — `@zanix/space@^0.2.0`'s own Vite build pipeline wires
  // `@vitejs/plugin-react`'s `reactCompiler` option for real, and that plugin resolves this
  // package by name from the consuming project at build time (never bundled inside
  // `@vitejs/plugin-react` itself). Latest published npm version verified directly against
  // `https://registry.npmjs.org/babel-plugin-react-compiler` (`dist-tags.latest`).
  'babel-plugin-react-compiler': 'npm:babel-plugin-react-compiler@^1.0.0',
} as const satisfies Record<string, string>

/** Every key `ZANIX_DEPENDENCY_VERSIONS` declares — the closed set of `@zanix/*` import
 * specifiers `cli` knows how to resolve a version for. */
export type ZanixDependency = keyof typeof ZANIX_DEPENDENCY_VERSIONS

/**
 * Every `@zanix/*` package a freshly scaffolded project of this type actually imports — verified
 * against the real generator/template output, not assumed. `library` gets none: its locally
 * generated `mod.ts`/`src/modules/mod.ts` starter content (`getLibraryRootModTemplate`/
 * `getLibraryModTemplate`, `projects/library.ts`) imports nothing `@zanix/*` by design.
 */
export const PROJECT_TYPE_DEPENDENCIES: Record<
  ZanixProjects,
  ZanixDependency[]
> = {
  library: [],
  // `getAppModTemplate`'s generated `mod.ts` imports both — `@zanix/app` for `defineZanixApp`/
  // `ZanixAppDefinition`, `@zanix/utils/logger` for the real Zanix logger (never `console`, see
  // this list's own header doc).
  app: ['@zanix/app', '@zanix/utils/logger'],
  // `mod.ts` (see `getSpaceModTemplate`) imports `bootstrapRemoteApp` from `@zanix/app/runtime` —
  // never `@zanix/core` (a pure frontend project has no reason to depend on its backend-aggregator
  // tier), and no longer `@zanix/server` directly either (`bootstrapRemoteApp` wraps that call
  // internally) — no generated `space` file (`mod.ts`/`space.app.ts`/page/comet
  // templates) imports `@zanix/server` directly.
  space: ['@zanix/space', '@zanix/app/runtime'],
  // `@zanix/asyncmq/jobs` is required alongside the bare `@zanix/asyncmq` entry — `server.ts`'s own
  // tree seeds an `example-job.defs.ts` via `planJob` (the same `plan<Name>` `zanix generate job`
  // uses), whose rendered content imports `registerCronJob` from that subpath (see
  // `ZANIX_DEPENDENCY_VERSIONS`'s own entry for it).
  server: [
    '@zanix/server',
    '@zanix/datamaster',
    '@zanix/asyncmq',
    '@zanix/asyncmq/jobs',
    '@zanix/validator',
    '@zanix/core',
  ],
  'space-server': [
    '@zanix/space',
    '@zanix/server',
    '@zanix/datamaster',
    '@zanix/asyncmq',
    '@zanix/asyncmq/jobs',
    '@zanix/validator',
    '@zanix/core',
  ],
}

/**
 * For `zanix generate` on an already-scaffolded project: adds `pkg`'s import to `deno.json` if it's
 * not declared yet, resolving the version from `ZANIX_DEPENDENCY_VERSIONS` — the same table
 * `zanix new` reads from, so a generator's declared dependency never drifts from what a fresh
 * scaffold of the same type would have written. Never overrides an existing entry, same
 * never-clobber guarantee as `ensureConstant` — a version the project owner already pinned by hand
 * is left alone.
 */
export async function ensureZanixDependency(
  root: string | undefined,
  pkg: ZanixDependency,
): Promise<void> {
  const configPath = getConfigDir(root)
  if (!configPath) return

  const config = readConfig(configPath)
  if (config.imports?.[pkg]) return

  config.imports = { ...config.imports, [pkg]: ZANIX_DEPENDENCY_VERSIONS[pkg] }
  await saveConfig(config, configPath)
}
