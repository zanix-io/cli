import type { ConfigFile, ZanixProjects } from '@zanix/types'

import { getFolderName, getRelativePath } from '@zanix/helpers'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { WORKER_MODULE } from 'commands/new/lib/tree/projects/server.ts'
import {
  PROJECT_TYPE_DEPENDENCIES,
  THIRD_PARTY_DEPENDENCY_VERSIONS,
  ZANIX_DEPENDENCY_VERSIONS,
} from 'utils/config/dependencies.ts'

/** Shared by every generated runnable task (`start`/`worker`, and `zanix prepare --docker -p
 * app`'s own `serve` task — see `commands/prepare/lib/docker/files/app-entrypoint.ts`) — a single
 * source of truth so the two can never drift apart. */
export const RUN_PERMISSIONS =
  '--allow-net --allow-env --allow-read --allow-sys --allow-write --allow-ffi --no-prompt'

export const linterBaseRules = [
  'eqeqeq',
  'default-param-last',
  'camelcase',
  'no-await-in-loop',
  'no-const-assign',
  'no-eval',
  'no-non-null-asserted-optional-chain',
  'no-non-null-assertion',
  'no-self-compare',
  'no-sync-fn-in-async-fn',
  'no-throw-literal',
  'no-useless-rename',
]

/**
 * Generate imports or alias for zanix project structure
 * @param folders - A tree node exposing its own `subfolders` map (each value a
 * `{ NAME, FOLDER }`-shaped node) — e.g. `getZanixPaths(type)` itself — not a flat folder-name
 * record.
 * @param testsPath - Optional folder name to exclude from the generated imports (e.g. `@tests`)
 */
export function generateImports(
  // deno-lint-ignore no-explicit-any
  folders: Record<string, any>,
  testsPath?: string,
) {
  const imports: Record<string, string> = {}

  Object.keys(folders.subfolders).forEach((key) => {
    const folder = folders.subfolders[key]
    if (!folder) return
    const name = folder.NAME || getFolderName(folder.FOLDER)
    if (name === testsPath) return
    imports[`${name}/`] = `./${getRelativePath(folder.FOLDER)}/`
  })

  return imports
}

/**
 * Define a base `deno` configuration file
 * @param type - Zanix project type (`app`, `server`, `space`, `space-server` or `library`)
 * @param renderer - `--renderer`'s own value, `space`/`space-server` only. Defaults to `'react'`,
 * identical in every respect to omitting it — same convention `@zanix/space`'s own
 * `SpacePluginOptions.renderer` already establishes. Ignored for every other project type.
 */
export function baseZnxConfig(
  type: ZanixProjects,
  renderer: 'react' | 'preact' = 'react',
): ConfigFile {
  const paths = getZanixPaths(type)
  const znxMainFolders = paths.subfolders
  const dist = znxMainFolders['.dist'].NAME
  const name = '@project/name'
  const testsPaths = znxMainFolders.src.subfolders['@tests']
  const imports = generateImports(znxMainFolders.src, testsPaths.NAME)
  const linterTags = ['recommended', 'jsr']
  const compilerOptions: ConfigFile['compilerOptions'] = {
    strict: true,
    noImplicitAny: true,
  }
  const libraryOpts: Record<string, unknown> = {
    exports: {},
    nodeModulesDir: 'auto',
  }

  const tests = testsPaths.FOLDER.replace(paths.FOLDER, '')

  // Only project types whose `mod.ts` actually starts a running process (`Zanix.start()` for
  // `server`/`space-server`, `activateApps()`+`bootstrapServers()` for `space`) get a `dev`/`start`
  // shortcut. `library` has no entrypoint at all; `app`'s `mod.ts` is a manifest export only — it
  // never calls `.serve()` itself, since that needs resource/config values (a DB URI, a port) the
  // CLI can't know ahead of time (see `getAppModTemplate`'s own doc) — a `deno run mod.ts` there
  // would silently do nothing, worse than not offering the task at all.
  const hasRunnableEntrypoint = type === 'server' || type === 'space' ||
    type === 'space-server'
  // `space`/`space-server` get `zanix space dev` — real file-watching HMR (SSR module invalidation,
  // asset serving, browser reload), not a bare process restart — instead of the generic
  // `deno run --watch` every other runnable type still gets. `start` (production) is IDENTICAL for
  // every type regardless: `zanix space dev` is a dev-only, additive capability layered on top of
  // the exact same `mod.ts`/`bootstrapServers()` production path, never a replacement for it — see
  // `zanix space dev`'s own doc for why production correctness/efficiency must never depend on it.
  const isSpaceType = type === 'space' || type === 'space-server'
  // `worker.ts` (see `getWorkerModTemplate`) only exists for `server`/`space-server` — plain
  // `space` has no `@zanix/core`/`@zanix/asyncmq` dependency to bootstrap a worker with.
  const hasWorkerEntrypoint = type === 'server' || type === 'space-server'
  const tasks: ConfigFile['tasks'] = hasRunnableEntrypoint
    ? {
      dev: isSpaceType
        ? 'zanix space dev'
        : `deno check && deno run --watch --env-file=.env -A ${MAIN_MODULE}`,
      // `--env-file=.env` degrades gracefully (a Deno warning, not an error) when `.env` doesn't
      // exist yet — verified empirically, so this is safe as a default even though `zanix new`
      // itself never scaffolds a `.env` file.
      start: `deno run --env-file=.env ${RUN_PERMISSIONS} ${MAIN_MODULE}`,
      // Same permission set as `start` (this process never opens its own HTTP listener, but still
      // needs `--allow-net` for whatever connectors/outbound requests its jobs make) — pointed at
      // `worker.ts` instead. A separate `deno run`/process, meant to run alongside `start` in
      // production (e.g. a second container/dyno), never as a replacement for it.
      ...(hasWorkerEntrypoint
        ? {
          worker: `deno run --env-file=.env ${RUN_PERMISSIONS} ${WORKER_MODULE}`,
        }
        : {}),
    }
    : undefined

  if (type === 'space' || type === 'space-server') {
    linterTags.push(...['react', 'jsx'])
    // The modern automatic transform (matching @zanix/space's own deno.json) — never the classic
    // 'react' transform, which requires `import React from 'react'` in scope in every JSX file;
    // none of @zanix/space's own examples/generated scaffold do that. `jsxImportSource` follows
    // `--renderer` — every `.tsx` file in this project transpiles against whichever runtime the
    // project actually declared via `defineSpaceApp({ renderer })` (`getSpaceAppTemplate`'s own
    // doc); the two must always agree, since `@zanix/space`'s own generator templates
    // (`comet`/`page`/`layout`/`error`/`loading`) are plain, renderer-agnostic JSX that resolves
    // purely off this compiler option, never a hardcoded `react`/`preact` import of their own.
    compilerOptions.jsx = 'react-jsx'
    compilerOptions.jsxImportSource = renderer
  }
  if (type === 'library' || type === 'app') {
    // A `defineZanixApp()`-based package is published/consumed exactly like any other Deno/JSR
    // library — see `@zanix/app`'s own `docs/PUBLISHING.md` — so it gets the same `exports`/
    // `publish` shape `library` already does, not a bespoke one.
    libraryOpts.exports = { '.': `./${MAIN_MODULE}` }
    libraryOpts.publish = {
      exclude: ['.github', tests],
    }
  }
  // Declares exactly the `@zanix/*` packages this project type's own scaffold imports — verified
  // per-type, not assumed (see `PROJECT_TYPE_DEPENDENCIES`'s own doc). Without this, a freshly
  // generated project fails `deno check`/`deno run` immediately, which is worse than an empty
  // scaffold, not merely "not yet complete". Versions come from `ZANIX_DEPENDENCY_VERSIONS`, the
  // single place in `cli` where a compatible version is ever declared.
  for (const pkg of PROJECT_TYPE_DEPENDENCIES[type]) {
    imports[pkg] = ZANIX_DEPENDENCY_VERSIONS[pkg]
  }
  if (type === 'space' || type === 'space-server') {
    // `jsxImportSource` above means every `.tsx` file in this project (starting with the
    // scaffolded `page.tsx`) has an implicit `<renderer>/jsx-runtime` import — needs that same
    // package declared here, or `deno check` fails immediately on the very first generated file.
    // `npm:` specifiers resolve their own subpaths automatically (unlike JSR's `@zanix/app/runtime`
    // above), so no separate `<renderer>/jsx-runtime` entry is needed. Version comes from
    // `THIRD_PARTY_DEPENDENCY_VERSIONS`, same centralization as `ZANIX_DEPENDENCY_VERSIONS` above.
    // Never both `react` and `preact` declared at once — matches `defineSpaceApp({ renderer })`'s
    // own "whole project, never a hybrid" contract.
    imports[renderer] = THIRD_PARTY_DEPENDENCY_VERSIONS[renderer]
  }

  return {
    name,
    zanix: {
      project: type,
    },
    ...(tasks ? { tasks } : {}),
    compilerOptions,
    lint: {
      rules: {
        tags: linterTags,
        include: linterBaseRules,
      },
      exclude: [dist],
      plugins: [
        'jsr:@zanix/utils/linter/deno-zanix-plugin',
      ],
      report: 'pretty',
    },
    fmt: {
      exclude: [dist],
      proseWrap: 'always',
      indentWidth: 2,
      singleQuote: true,
      lineWidth: 100,
      useTabs: false,
      semiColons: false,
    },
    imports,
    ...libraryOpts,
    test: {
      include: [
        `${tests}/**/*.test.ts`,
      ],
    },
  }
}
