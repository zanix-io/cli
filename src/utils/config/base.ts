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

/**
 * Shared by every generated runnable task (`start`/`worker`, and `zanix prepare --docker -p
 * app`'s own `serve` task — see `commands/prepare/lib/docker/files/app-entrypoint.ts`) — a single
 * source of truth so the two can never drift apart.
 *
 * `--allow-run=ffmpeg,ffprobe` (named, not blanket `--allow-run`) is here for the same reason
 * `--allow-ffi` already is: `@zanix/space`'s own `VideoTranscoder` needs it to invoke system
 * `ffmpeg`/`ffprobe` (`Deno.Command`), but only if an app's own code actually calls it — inert
 * otherwise, same as `--allow-ffi` is for an app that never touches `sharp`. Granted here
 * unconditionally, for every project type, rather than only `space`/`space-server` — this constant
 * is deliberately one shared value (see its own doc above); scoping it per type would need
 * `start`/`worker`/`serve` to each resolve a different permission string, real, unrelated surgery
 * to the task-generation path this feature doesn't need. `@zanix/space` never installs either
 * binary itself — see `deploy.md`'s own "Media transcoding" section for who does, per target.
 */
export const RUN_PERMISSIONS =
  '--allow-net --allow-env --allow-read --allow-sys --allow-write --allow-ffi --allow-run=ffmpeg,ffprobe --no-prompt'

/** The lint rules every generated project's own `deno.json` enables on top of its `linterTags`
 * preset (`recommended`/`jsr`), regardless of project type. */
export const LINTER_BASE_RULES = [
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
): Record<string, string> {
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
 * The version every freshly-scaffolded, never-yet-published `zanix new`/`zanix generate` project
 * starts at — matches the common Deno/JSR "first version" convention (confirmed against
 * `@zanix/space`'s own real, still-early `deno.json`, itself pinned at `0.1.0`), not a guess.
 * `deno publish --dry-run` fails outright on a `deno.json` with no `version` field at all
 * (`ConfigFile['version']` is optional in `@zanix/types`, but JSR itself requires it at publish
 * time), so this is written unconditionally for every project type, not only `library`/`app` —
 * see `baseZnxConfig`'s own doc for why a consistent default beats a per-type inconsistency.
 */
export const INITIAL_PROJECT_VERSION: NonNullable<ConfigFile['version']> = '0.1.0'

/**
 * Define a base `deno` configuration file
 * @param type - Zanix project type (`app`, `server`, `space`, `space-server` or `library`)
 * @param renderer - `--renderer`'s own value, `space`/`space-server` only. Defaults to `'react'`,
 * identical in every respect to omitting it — same convention `@zanix/space`'s own
 * `SpacePluginOptions.renderer` already establishes. Ignored for every other project type.
 * @param root - The same `root`/project-name value `saveZanixConfig` itself receives — a plain
 * leaf directory name in the common `zanix new <type> <name>` case, but occasionally a full
 * nested/absolute path (e.g. an isolated temp directory in this project's own test suite). Only
 * its basename (`getFolderName`) is ever used, to derive the generated `name` field's
 * package-name half. Optional — omitted entirely, the field falls back to the literal `'name'` so
 * the emitted `deno.json` stays a well-formed, unmistakable placeholder either way.
 */
export function baseZnxConfig(
  type: ZanixProjects,
  renderer: 'react' | 'preact' = 'react',
  root: string | undefined = undefined,
): ConfigFile {
  const paths = getZanixPaths(type)
  const znxMainFolders = paths.subfolders
  const dist = znxMainFolders['.dist'].NAME
  // `@your-scope` is deliberately, unmistakably fake — no `zanix new`/`zanix generate` invocation
  // can ever know a user's REAL, owned JSR scope, so this can never become instantly publishable
  // on its own; it must always be hand-edited before a real `deno publish`. What it CAN do
  // correctly is derive the package-name half from the real, already-known project name, instead
  // of a second forgotten literal (`'@project/name'`) that looked deceptively real.
  const name = `@your-scope/${root ? getFolderName(root) : 'name'}`
  const testsPaths = znxMainFolders.src.subfolders['@tests']
  const imports = generateImports(znxMainFolders.src, testsPaths.NAME)
  const linterTags = ['recommended', 'jsr']
  // `src/typings/index.d.ts` (`getCommonTree`, `commands/new/lib/tree/projects/commons.ts`) is
  // scaffolded as ambient global types (`declare global { ... }`) for every project type. Without
  // wiring it into `compilerOptions.types` here, `deno check`/`deno test` only pick up a type it
  // declares when some statically-reachable file happens to import that module — never true for a
  // pure `declare global` file — so a type used only from code the static graph can't see (e.g. a
  // runtime-discovered handler) silently fails to resolve instead of being caught. Same fix already
  // applied by hand in a real sibling project's own `deno.json` before this was wired in here.
  const typingsPath = znxMainFolders.src.subfolders.typings
  const compilerOptions: ConfigFile['compilerOptions'] = {
    strict: true,
    noImplicitAny: true,
    types: [`./${getRelativePath(typingsPath.FOLDER)}/index.d.ts`],
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
  // Unconditional, every project type (unlike `dev`/`start`/`worker` below, which need a real
  // runnable entrypoint) — both read-only checks against the project's own `deno.lock`/import
  // graph, meaningful for a `library`/`app` just as much as a runnable service. Invokes the
  // published `@zanix/cli` (`jsr:@zanix/cli`), not a local task self-reference, so these work the
  // same in a freshly-scaffolded project with no other dependency on this package.
  const checkTasks: ConfigFile['tasks'] = {
    'check-cycles': 'deno run -A jsr:@zanix/cli check-cycles',
    'check-duplicates': 'deno run -A jsr:@zanix/cli check-duplicates',
  }
  const tasks: ConfigFile['tasks'] = hasRunnableEntrypoint
    ? {
      ...checkTasks,
      // `deno install` runs first, ONLY for `space`/`space-server` — `zanix space dev`'s own Vite
      // server resolves npm-backed imports (e.g. `@zanix/space`'s client hydration code importing
      // `react-dom` directly) straight from the local npm cache/node_modules, never lazily on
      // first request the way Deno's own module graph does. A project scaffolded and immediately
      // run via this task (never having run `deno install`/`deno run` once beforehand) would
      // otherwise hit a confusing Vite "Does the file exist?" pre-transform error on its very
      // first Comet. Idempotent and near-instant
      // once already installed, so this is safe to run unconditionally on every `dev` invocation,
      // not just the first. The generic `deno run --watch` task below needs no equivalent: a plain
      // `server`/`app` project's own module graph is Deno-native, resolved lazily as normal.
      dev: isSpaceType
        ? 'deno install && zanix space dev'
        : `deno check && deno run --watch --env-file=.env -A ${MAIN_MODULE}`,
      // `space`/`space-server` only — the client-bundle build step (`zanix space build`) other
      // project types have no equivalent of (a plain `deno run --watch` dev loop needs no separate
      // build task; `zanix space dev` already builds nothing, it serves through Vite directly).
      // `zanix prepare --docker`'s own `dockerfile.space.base` runs this exact task (`deno task
      // build`) in its BUILD stage, rather than invoking `deno run -A jsr:@zanix/cli space build`
      // directly — one declared build step, not two independently-maintained copies of the same
      // command that could drift apart (a pinned `--out-dir`/`--obfuscate` flag added to one but
      // not the other, for instance).
      ...(isSpaceType ? { build: 'zanix space build' } : {}),
      // `--env-file=.env` degrades gracefully (a Deno warning, not an error) when `.env` doesn't
      // exist yet, so this is safe as a default even though `zanix new`
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
    : checkTasks

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
    // library — see `@zanix/app`'s own `docs/publishing.md` — so it gets the same `exports`/
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
    // Unlike the renderer's own `jsxImportSource`-driven `<renderer>/jsx-runtime` import just
    // above (compiler-mediated, auto-resolved) — a PLAIN hand-written subpath import in generated
    // application code (`preact/hooks`, imported by `--theme astronaut`'s own comet demo under
    // this renderer — see `getHooksEntry`, `lib/renderer.ts`) is an ordinary import Deno's own
    // import-map resolution needs declared explicitly, the same as any other npm subpath. Declared
    // unconditionally whenever `renderer === 'preact'`, not gated on `--theme` too — see
    // `THIRD_PARTY_DEPENDENCY_VERSIONS`'s own doc for why a declared-but-unused entry is the safer
    // default here.
    if (renderer === 'preact') {
      imports['preact/hooks'] = THIRD_PARTY_DEPENDENCY_VERSIONS['preact/hooks']
    }
    // React Compiler has no Preact equivalent — `@zanix/space`'s own build pipeline only wires
    // `@vitejs/plugin-react`'s `reactCompiler` option under the `react` renderer, and that plugin
    // resolves this package by name from the consuming project (see its own doc in
    // `THIRD_PARTY_DEPENDENCY_VERSIONS`). Without this, a freshly generated `react`-renderer
    // project's own `zanix space build` fails immediately on its first `.tsx` comet.
    if (renderer === 'react') {
      imports['babel-plugin-react-compiler'] =
        THIRD_PARTY_DEPENDENCY_VERSIONS['babel-plugin-react-compiler']
    }
  }

  return {
    name,
    version: INITIAL_PROJECT_VERSION,
    zanix: {
      project: type,
    },
    ...(tasks ? { tasks } : {}),
    compilerOptions,
    lint: {
      rules: {
        tags: linterTags,
        include: LINTER_BASE_RULES,
      },
      exclude: [dist],
      plugins: [ZANIX_DEPENDENCY_VERSIONS['@zanix/utils/linter']],
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
