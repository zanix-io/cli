import {
  type Loader,
  MediaType,
  RequestedModuleType,
  ResolutionMode,
  Workspace,
} from '@deno/loader'
import { dirname, fromFileUrl, join, resolve as resolvePath, toFileUrl } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'
import { walk } from '@std/fs'
import { init as esModuleLexerInit, parse as parseEsModule } from 'es-module-lexer'

// A real, purpose-built JS/TS-aware lexer, not a hand-rolled regex/comment scanner — it correctly
// tells a real import/export specifier apart from example code inside a comment or a plain string
// value ELSEWHERE in the file (an error message quoting `import 'x'` as sample text, for
// instance), something no regex over the raw text can do reliably. `init` resolves once per
// process; every later `findSpecifierMatches` call reuses the already-initialized WASM instance.
await esModuleLexerInit

/**
 * Imports a file that belongs to a CONSUMING project — never `@zanix/cli` itself — with that
 * file's own bare specifiers resolved against the PROJECT's own nearest `deno.json`/`deno.jsonc`,
 * never `@zanix/cli`'s.
 *
 * ## The problem this solves
 *
 * A plain `await import(toFileUrl(path).href)` executed from inside `@zanix/cli`'s own process
 * resolves every bare specifier the imported file — and anything it reaches through a RELATIVE
 * import — against `@zanix/cli`'s OWN configuration. A whole `deno run <entry>` invocation shares
 * one governing resolver, rooted at the entry module's own config, no matter which directory an
 * individual imported file physically lives in. A project's own `space.app.ts` (or a page, or a
 * `*.client.ts` GraphQL client, or a `gql/**\/*.gql.ts` module) importing a package `@zanix/cli`
 * doesn't itself declare — or declares at a different version — fails outright with "not a
 * dependency and not in import map", or silently resolves the wrong package, with nothing about
 * the failure pointing at the real cause.
 *
 * ## The fix
 *
 * {@linkcode importProjectModule} builds a real `@deno/loader` `Workspace` anchored at the target
 * file's own nearest `deno.json(c)` — walking up from its directory, the exact discovery a plain
 * `deno run <that file>` would perform on its own — then recursively resolves and rewrites every
 * bare specifier the file (and every file it reaches through a RELATIVE import) uses, before
 * handing anything to a real native `import()`.
 *
 * ## What actually gets rewritten, in priority order
 *
 * 1. A bare specifier `@zanix/cli`'s OWN configuration can ALSO resolve — to ANY target, even a
 *    genuinely different one than the project's own config would give — is left completely
 *    untouched. This matters whenever `@zanix/cli` ITSELF natively imports a package for its own
 *    orchestration and shares real, module-level protocol state through it with whatever
 *    `space.app.ts` imports. Resolving such a specifier against the PROJECT's own config instead —
 *    even to a valid, different target — would load a SEPARATE module instance of that package,
 *    silently breaking that shared state. Deferring to native resolution whenever `@zanix/cli`
 *    already has an answer sidesteps this entirely.
 *
 *    **EXCEPT** for `@zanix/space`/`@zanix/app`/`@zanix/server` and their subpaths
 *    ({@linkcode PROJECT_ANCHORED_ONLY_PACKAGES}) — the historical motivating case for this whole
 *    step, but `@zanix/cli` no longer holds a separate native instance of any of them at all: its
 *    own dev/build orchestration ({@linkcode importProjectDependency}, used by `dev/action.ts`/
 *    `build/action.ts`/`import-space-app.ts`/`dev/validation.ts`) resolves them against the SAME
 *    project config this step 2 does, unconditionally. Skipped entirely for these three, falling
 *    straight through to step 2 below.
 *
 *    **ALSO EXCEPT** when `@zanix/cli`'s own answer lands INSIDE `@zanix/cli`'s own hand-written
 *    source tree ({@linkcode resolvesIntoCliOwnSourceTree}) — a false positive of this exact check,
 *    never the genuine identity-sharing case above: `@zanix/cli`'s own `deno.jsonc` also declares
 *    plain internal folder aliases (`typings/`, `shared/`, `utils/` → `./src/{typings,shared,utils}/`),
 *    purely so `@zanix/cli`'s OWN source can use short bare-specifier-style imports internally —
 *    and `zanix new` scaffolds the IDENTICAL alias names into every consuming project's own
 *    `deno.json`. A project file's own `import 'utils/x.ts'` therefore ALSO "resolves successfully"
 *    against `@zanix/cli`'s config, but to `@zanix/cli`'s OWN `src/utils/x.ts`, never the
 *    project's — silently, until the two files' exports diverge (e.g. a project's own interactor
 *    importing `utils/constants.ts` resolves against `@zanix/cli`'s own same-named file instead of
 *    its own). Falls through to step 2 below in this case too, exactly as if `@zanix/cli`'s config
 *    had no answer at all.
 * 2. Only a specifier `@zanix/cli` genuinely has no answer for at all is resolved against the
 *    PROJECT's own configuration instead. A result that carries its own scheme (`jsr:`, `npm:`,
 *    `https:`, `node:`) is left exactly as `@deno/loader` resolved it: native `import()` follows
 *    one of these correctly from ANY governing config, since a published package carries its own
 *    self-contained dependency graph. A result that lands in `node_modules` (a real,
 *    already-installed npm package) is reconstructed back into its own scheme form instead of
 *    being handed to `import()` as a raw file path, which bypasses Deno's own CJS/ESM interop — a
 *    bare `'react/jsx-runtime'` resolved this way reads as a plain ESM re-export with no `jsx`
 *    named export. A result that
 *    lands anywhere else on disk is only followed recursively when a real `deno.json(c)` exists
 *    somewhere above it — proof it's genuinely part of a project's own source tree (or a
 *    linked/workspace sibling with its own config), not vendored third-party code otherwise
 *    materialized outside `node_modules` (Deno's own global npm/jsr cache, for instance).
 *
 * Every recursively rewritten local file is written to a real, temporary sibling of the ORIGINAL
 * file (immediately deleted once the top-level `import()` this function performs resolves) —
 * never a `blob:`/`data:` URL, unless the original file's own directory isn't writable. This
 * matters for real, not just tidy, reasons: a module that computes `new URL('./sibling.ts',
 * import.meta.url)` at its own top level (a genuine, real pattern — `@zanix/space`'s own default
 * error-view resolution does exactly this) needs that call to land on the REAL sibling file, which
 * only works when the executing module's own location is a real path in the REAL directory the
 * sibling actually lives in — a `blob:` base has no meaningful hierarchical structure for relative
 * resolution to work against at all, throwing `TypeError: Invalid URL` against a real
 * `@zanix/space` source module that relies on it.
 *
 * As a consequence of resolving through the project's own real configuration, this also honors a
 * project's own `"links"` override for a locally checked-out, unpublished dependency — something a
 * plain `import()` from inside `@zanix/cli`'s own process could never do.
 *
 * ## Real, known limitations
 *
 * A genuine import CYCLE between two local project files (A relatively imports B, and B
 * relatively imports A back) cannot be rewritten this way: producing A's final rewritten text
 * requires already knowing B's, and vice versa. {@linkcode importProjectModule} detects this and
 * throws a clear error naming the file, rather than hanging forever. None of this function's real
 * callers (an app manifest, a page, a GraphQL client/query module) are designed to import each
 * other back, so this is not expected to matter in practice.
 *
 * A non-string dynamic `import(...)` argument (a template literal, a computed expression) cannot
 * be resolved statically either — left untouched, exactly as it would have been without this
 * function, since no static rewrite can know what it resolves to ahead of time.
 *
 * An `npm:`/`jsr:`-mapped bare specifier reachable only through a `scopes` entry (never the
 * project's own top-level `imports`) falls back to `resolveSync`'s own error —
 * {@linkcode reconstructSchemeSpecifier}'s own fallback only ever reads the top-level map. A plain
 * top-level alias — the normal shape a project declares one in — resolves correctly.
 *
 * @module
 */

/** Walks up from `startDir` looking for the nearest `deno.json`/`deno.jsonc`, preferring a
 * `"workspace"`-bearing config over the nearest plain one — a workspace root is what actually
 * governs resolution for every member underneath it. A cheap substring check, not a full JSONC
 * parse: this only needs to notice the key's presence, never its value. Returns `undefined` when
 * nothing is found anywhere above `startDir`, letting `Workspace` fall back to its own default
 * auto-discovery. */
export function findDenoConfigPath(startDir: string): string | undefined {
  let nearest: string | undefined
  let dir = resolvePath(startDir)
  const fsRoot = resolvePath('/')

  while (true) {
    for (const name of ['deno.json', 'deno.jsonc']) {
      const candidate = join(dir, name)
      let content: string
      try {
        content = Deno.readTextFileSync(candidate)
      } catch {
        continue
      }
      nearest ??= candidate
      if (/["']workspace["']\s*:/.test(content)) return candidate
    }
    if (dir === fsRoot) break
    dir = dirname(dir)
  }
  return nearest
}

/** Converts a `deno.json(c)`'s own `"minimumDependencyAge"` field into the `newestDependencyDate`
 * cutoff {@linkcode Workspace} accepts. `@deno/loader`'s own config-file discovery (`configPath`)
 * reads a project's `imports`/`compilerOptions`/etc. automatically, but never translates this ONE
 * field on its own: a project's own `"minimumDependencyAge": 0` has zero effect on a `Workspace`
 * constructed from its `configPath` alone, still rejecting a same-day-published dependency with
 * Deno's own default 24h window. Every `Workspace` this module constructs needs this computed and
 * passed explicitly instead. Supports the two shapes this ecosystem's own configs actually use — a
 * plain number (minutes, matching `deno install --min-dep-age`'s own numeric form) and an absolute
 * RFC3339 cutoff date/timestamp string; an ISO-8601 duration string (`'P2D'`) isn't handled yet and
 * falls back to no override (Deno's own default) rather than throwing. Returns `undefined` — no
 * override, Deno's own default applies — when `configPath` is `undefined` (config-file discovery,
 * not a specific file this function could read) or the file has no recognized
 * `minimumDependencyAge`. */
export function readNewestDependencyDate(configPath: string | undefined): Date | undefined {
  if (!configPath) return undefined
  let config: { minimumDependencyAge?: number | string }
  try {
    config = parseJsonc(Deno.readTextFileSync(configPath)) as typeof config
  } catch {
    return undefined
  }
  const value = config.minimumDependencyAge
  if (typeof value === 'number') return new Date(Date.now() - value * 60_000)
  if (typeof value === 'string') {
    const asDate = new Date(value)
    if (!Number.isNaN(asDate.getTime())) return asDate
  }
  return undefined
}

/** One `Loader` per discovered config path — never a single process-wide singleton, and never one
 * per file or call. `@deno/loader` never caches a module INSTANCE itself (it only ever computes
 * resolution/content on demand), so sharing an instance across every file governed by the same
 * config introduces no second source of module identity. */
const loadersByConfigPath = new Map<string, Promise<Loader>>()

function getLoaderFor(configPath: string | undefined): Promise<Loader> {
  const key = configPath ?? ''
  let loaderPromise = loadersByConfigPath.get(key)
  if (!loaderPromise) {
    loaderPromise = new Workspace({
      platform: 'node',
      configPath,
      // `WorkspaceOptions.newestDependencyDate` is TYPED as `Date`, but the underlying WASM
      // binding's actual (de)serializer rejects a real `Date` instance outright at runtime,
      // throwing `Failed deserializing workspace options.: Error: invalid type: JsValue(Date),
      // expected an RFC 3339 formatted date and time string` — it only accepts the ISO string
      // form. The cast below bridges this genuine type/runtime mismatch in the currently pinned
      // `@deno/loader` itself, not a mistake in `readNewestDependencyDate`'s own `Date`-returning
      // signature (kept as `Date` since that's the semantically correct return type for every
      // OTHER caller).
      newestDependencyDate: readNewestDependencyDate(configPath)?.toISOString() as
        | Date
        | undefined,
    }).createLoader()
    loadersByConfigPath.set(key, loaderPromise)
  }
  return loaderPromise
}

/** `@zanix/cli`'s OWN nearest config — computed once, from THIS module's own location, and
 * reused as the comparison point {@linkcode resolveReplacement} checks a recursion candidate
 * against (see that function's own doc for why).
 *
 * Stays `undefined` when `import.meta.url` isn't a real `file://` URL — i.e. once `@zanix/cli`
 * itself is loaded via `jsr:` (any real global install, `deno install -g jsr:@zanix/cli` included):
 * there is no local checkout for it to have a config path FOR at all in that case, so
 * `fromFileUrl` would throw `Must be a file URL` on every single invocation, real projects
 * included. Leaving it
 * `undefined` is not a workaround so much as the structurally correct answer: `resolvesIntoCliOwnSourceTree`
 * already treats a falsy `cliConfigPath` as "no distinct cli source tree to collide with" (see its
 * own doc), and `getLoaderFor(undefined)` doesn't mean "no config" either — per `@deno/loader`'s
 * own `WorkspaceOptions.configPath` doc, omitting it means "do config file discovery", which from
 * inside a real `zanix space build`/`dev` run auto-discovers the SAME config the calling project's
 * own `referrerLoader` already uses (both run with the project as `Deno.cwd()`). So `cliResolved`
 * below ends up identical to the project's own resolution, `resolvesIntoCliOwnSourceTree` correctly
 * stays `false`, and this always defers to native resolution unchanged — exactly the outcome the
 * alias-collision check exists to produce when there is no real collision left to guard against. */
let cliConfigPathComputed = false
let cliConfigPath: string | undefined

/** `@zanix/cli`'s OWN nearest config path, if any — the same lazily-computed, once-per-process
 * value {@linkcode getCliLoader} builds its `Loader` from (see that function's own doc for why
 * it's `undefined` under a real global install). Exported so {@linkcode prepareTransitiveCollisionReexec}
 * can merge cli's OWN `"imports"` (its internal `typings/`/`shared/`/`utils/`/`cli` aliases) into a
 * re-exec'd process's config without ever duplicating this computation. */
export function getCliConfigPath(): string | undefined {
  if (!cliConfigPathComputed) {
    cliConfigPath = import.meta.url.startsWith('file://')
      ? findDenoConfigPath(dirname(fromFileUrl(import.meta.url)))
      : undefined
    cliConfigPathComputed = true
  }
  return cliConfigPath
}

function getCliLoader(): Promise<Loader> {
  return getLoaderFor(getCliConfigPath())
}

/** `true` when `resolvedUrl` — something `@zanix/cli`'s OWN loader resolved a bare specifier TO —
 * lands inside `@zanix/cli`'s OWN hand-written source tree (`dirname(cliConfigPath)`, excluding
 * `node_modules` under it) rather than a real external dependency (a JSR/npm package, wherever
 * Deno actually materializes one — its own global cache, or a local `node_modules` — never inside
 * `cli`'s own checked-out/published source itself).
 *
 * {@linkcode resolveReplacement} uses this to catch a false positive in its own "`cli`'s config
 * can also resolve this, leave it untouched" check (see that function's own doc): `cli`'s
 * `deno.jsonc` declares its own internal folder aliases (`typings/`, `shared/`, `utils/` →
 * `./src/{typings,shared,utils}/`, purely so `cli`'s OWN source can use short bare-specifier-style
 * imports internally) — and `zanix new` scaffolds the IDENTICAL alias names into every consuming
 * project's own `deno.json`. A project file importing `utils/constants.ts` therefore ALSO resolves
 * successfully against `cli`'s own config — but to `cli`'s OWN `src/utils/constants.ts`, never the
 * project's — the exact opposite of a genuine identity-sharing concern (`@zanix/space`,
 * `@zanix/server`, ...), which always resolves outside `cli`'s own source tree entirely. This stays
 * invisible only as long as both files happen to export the same names: a consuming project's own
 * `auth.interactor.ts` (`import { LOGIN_ACTIONS, TOKEN_EXPIRATION } from 'utils/constants.ts'`)
 * silently resolving against `cli`'s own `src/utils/constants.ts` instead of its own surfaces
 * loudly, with a stack trace pointing at `cli`'s own file path, the moment the two diverge. */
function resolvesIntoCliOwnSourceTree(resolvedUrl: string): boolean {
  if (!cliConfigPath || !resolvedUrl.startsWith('file://')) return false
  const cliRoot = dirname(cliConfigPath)
  const resolvedPath = fromFileUrl(resolvedUrl)
  return (resolvedPath === cliRoot || resolvedPath.startsWith(`${cliRoot}/`)) &&
    !resolvedPath.includes('/node_modules/')
}

/** A second, deeper case of the identical false-positive shape {@linkcode resolvesIntoCliOwnSourceTree}
 * exists to catch, at that function's own call site. When `cliConfigPath` is `undefined` (any
 * genuine global install), `cliLoader` is built via `@deno/loader`'s own config-file
 * auto-discovery, starting from `Deno.cwd()` — the served PROJECT's own directory during a real
 * `zanix space dev`/`build` run — so it becomes identical to `referrerLoader`, discovering the
 * project's own config instead of anything belonging to `cli`. A `file://` result under that exact
 * condition can never be a genuine `cli`-own-identity answer: `cli` has no local source tree of
 * its own to have a real answer for in the first place there, and a genuine package identity
 * (`@zanix/space` et al.) always resolves to a `jsr:`/`https:` target under a global install,
 * never `file://` (save for a deliberate local `links` override, which needs the same recursive
 * treatment a project's own file gets regardless) — so it must be `cliLoader`'s auto-discovery
 * matching a project's own bare LOCAL alias (e.g. `"triggers/": "./src/triggers/"`) instead.
 * Extracted as its own pure, testable function specifically because this exact branch can never be
 * exercised by a real `deno test` run (`cliConfigPath` is only ever `undefined` when this module
 * itself loads from a remote `jsr:`/`https:` specifier, never a local `file://` checkout — the
 * same limitation `getCliLoader`'s own test documents) — testing the pure boolean logic directly
 * is the next best thing to a real end-to-end repro. */
export function cliLoaderHasNoRealLocalAnswer(
  configPath: string | undefined,
  resolvedUrl: string,
): boolean {
  return !configPath && resolvedUrl.startsWith('file://') && !resolvedUrl.includes('/node_modules/')
}

/** A specifier already carrying its own scheme (`jsr:`, `npm:`, `https:`, `node:`, `data:`, ...)
 * is unambiguous on its own — never resolved through `Loader.resolveSync`, never rewritten. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** JS/TS-family media types — the only ones this function scans for further specifiers to
 * rewrite. A non-JS asset was never resolved through an import map in the first place, so it never
 * had the resolution ambiguity this function exists to fix — but see {@linkcode process}'s own
 * `JS_MEDIA_TYPES` branch for why CSS/JSON still need a real stub rather than being handed to
 * `import()` using their own resolved path unchanged: native `import()` cannot load either media
 * type at all on its own. */
const JS_MEDIA_TYPES = new Set<MediaType>([
  MediaType.JavaScript,
  MediaType.Jsx,
  MediaType.Mjs,
  MediaType.Cjs,
  MediaType.TypeScript,
  MediaType.Mts,
  MediaType.Cts,
  MediaType.Tsx,
])

/** JSON-family media types — the only OTHER media types this function knows how to safely stub
 * with real content (see {@linkcode process}'s own `JS_MEDIA_TYPES` branch). Every remaining
 * non-JS media type still falls through unchanged, exactly as before that fix. */
const JSON_MEDIA_TYPES = new Set<MediaType>([
  MediaType.Json,
  MediaType.Jsonc,
  MediaType.Json5,
])

/** The one filename prefix every temp file {@linkcode writeGeneratedModule} writes shares —
 * shared with {@linkcode sweepStaleGeneratedModules} below, which matches against this same
 * prefix to find one a killed earlier process left behind. Kept as one constant specifically so
 * the two can never drift apart. */
const GENERATED_MODULE_PREFIX = '.zanix-import-'

/** Reads `configPath`'s own top-level `imports` map and returns its raw, LITERAL value for
 * `specifier` (an exact key match only — no `scopes`, no prefix/alias expansion), or `undefined`
 * when there's no such entry, the file can't be read, or it doesn't parse. Only ever consulted as
 * a fallback for the one real gap `Loader.resolveSync` has: an `npm:` bare specifier needs a real
 * dependency-constraint solve to resolve without `Loader.addEntrypoints` — deliberately never
 * called here (see this module's own doc for why: the file path it would otherwise produce
 * bypasses Deno's own CJS/ESM interop entirely). A project's own declared literal (still carrying
 * its `npm:`/`jsr:` scheme, still possibly an unpinned semver range) is exactly what a normal
 * `import 'is-odd'` statement in that project would have resolved through on its own — handing it
 * to native `import()` unchanged lets Deno do that same resolution, interop included. */
function readImportMapValue(configPath: string, specifier: string): string | undefined {
  let parsed: unknown
  try {
    parsed = parseJsonc(Deno.readTextFileSync(configPath))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const imports = (parsed as Record<string, unknown>).imports
  if (typeof imports !== 'object' || imports === null) return undefined
  const value = (imports as Record<string, unknown>)[specifier]
  return typeof value === 'string' ? value : undefined
}

/** Splits `specifier` into its package name (`@scope/name` for a scoped package, the first path
 * segment otherwise) and whatever subpath follows (including the leading `/`, or `''` for the
 * bare package itself) — the same split every `npm:`/`jsr:` subpath specifier follows. */
function splitPackageSpecifier(specifier: string): { base: string; subpath: string } {
  const parts = specifier.split('/')
  const base = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return { base, subpath: specifier.slice(base.length) }
}

/** Base package names {@linkcode importProjectDependency} now resolves for `@zanix/cli`'s own
 * native orchestration calls (`dev/action.ts`, `build/action.ts`, `import-space-app.ts`,
 * `dev/validation.ts`) — `cli` no longer holds a SEPARATE, natively-loaded module instance of any
 * of these at all. `resolveReplacement`'s own "try `cli`'s config first" step below exists only to
 * protect shared module-level identity for a package `cli` ALSO imports natively for its own
 * orchestration (a renderer registry, a route registry, ...) — with no separate `cli`-native
 * import left to protect identity with for these three, deferring to `cli`'s own answer for them
 * has nothing left to guard, and would actively REINTRODUCE a divergence whenever `cli` itself
 * runs from a local checkout (`cliConfigPath` a real, fixed path, unrelated to `Deno.cwd()` —
 * `getCliLoader`'s own doc covers this): `cli`'s own native orchestration now always resolves
 * these against the SERVED PROJECT's config, so the project's own `space.app.ts` import must too,
 * unconditionally, in every install shape. */
const PROJECT_ANCHORED_ONLY_PACKAGES = new Set(['@zanix/space', '@zanix/app', '@zanix/server'])

/** Reconstructs a scheme-based specifier for `specifier` from `configPath`'s own `imports` map —
 * an exact match first, then the specifier's own base PACKAGE name with its subpath appended to
 * whatever scheme literal that package resolves to (the same shape a real `jsr:`/`npm:` subpath
 * specifier already takes, e.g. `npm:react@^X.Y.Z` + `/jsx-runtime` → `npm:react@^X.Y.Z/jsx-
 * runtime`). Returns `undefined` when neither is declared, or the declared value isn't itself
 * scheme-based (a local alias has nothing useful to reconstruct from). */
function reconstructSchemeSpecifier(configPath: string, specifier: string): string | undefined {
  const exact = readImportMapValue(configPath, specifier)
  if (exact !== undefined && SCHEME_RE.test(exact)) return exact

  const { base, subpath } = splitPackageSpecifier(specifier)
  if (base === specifier) return undefined
  const baseLiteral = readImportMapValue(configPath, base)
  if (baseLiteral === undefined || !SCHEME_RE.test(baseLiteral)) return undefined
  return baseLiteral + subpath
}

/** Matches Deno's own npm-cache directory layout — `.deno/<name>@<version>/node_modules/<name>/`
 * — capturing the package name (with a `+` still standing in for a scoped package's own `/`, e.g.
 * `@radix-ui+primitive`) and its resolved version. */
const NPM_CACHE_PATH_RE = /\/node_modules\/\.deno\/((?:@[^/+]+\+)?[^/@]+)@([^/]+)\/node_modules\//

/** A last-resort fallback for {@linkcode reconstructSchemeSpecifier} when there's no local config
 * FILE to read at all: `cliConfigPath` is `undefined` for any genuine `deno install -g
 * jsr:@zanix/cli` install (`getCliLoader`'s own doc), so `reconstructSchemeSpecifier(cliConfigPath,
 * specifier)` silently evaluates to `undefined` on every real global install, falling through to
 * the raw `file://` `node_modules` path this whole mechanism exists to avoid — a bare
 * `'react/jsx-runtime'` resolved that way still fails with the same "does not provide an export"
 * error the scheme reconstruction above is meant to prevent, since it never runs without a config
 * path.
 *
 * Needs no config file at all: the version is parsed directly out of the ALREADY-RESOLVED
 * `resolvedPath` itself, via Deno's own stable npm-cache directory convention
 * ({@linkcode NPM_CACHE_PATH_RE}), and combined with `specifier`'s own known package+subpath split
 * — the same shape `reconstructSchemeSpecifier` builds from a config's own declared value, just
 * sourced from the resolved path instead of a file read. Returns `undefined` when `resolvedPath`
 * doesn't match that layout at all (a vendored/non-npm dependency, or a resolver this convention
 * doesn't apply to) — never a wrong guess. */
export function reconstructNpmSpecifierFromResolvedPath(
  resolvedPath: string,
  specifier: string,
): string | undefined {
  const match = resolvedPath.match(NPM_CACHE_PATH_RE)
  if (!match) return undefined
  const version = match[2]
  const { base, subpath } = splitPackageSpecifier(specifier)
  return `npm:${base}@${version}${subpath}`
}

/** The literal filename every `zanix space` project's manifest lives at, at its root — kept in
 * sync BY HAND with `SPACE_APP_MODULE` (`commands/new/lib/tree/projects/space.ts`), never
 * imported from there: that module's own real top-level imports (the whole `zanix new` tree/
 * generator graph) have no business loading into this comparatively lightweight, broadly-reused
 * module just to read one string constant back out of it. Used purely as a referrer file for
 * {@linkcode importProjectDependency}'s own `@zanix/space` resolution — confirmed empirically that
 * a real referrer isn't even load-bearing here (`@deno/loader`'s own `resolveSync` returns the
 * identical result for a bare specifier whether or not the referrer path actually exists on
 * disk), but every real call site already has this exact file guaranteed to exist by the time it
 * calls this function (after `importSpaceApp`/`importProjectModule` on it already succeeded), so
 * there's no reason to invent a synthetic path instead. */
const PROJECT_MANIFEST_FILE = 'space.app.ts'

/** Resolves `specifier` through `loader`, forcing the real dependency-constraint solve for an
 * unexpanded `jsr:`/`http(s):` literal (same gap `resolveReplacement`'s own project-resolution
 * branch already documents in full), and reconstructing a scheme-based specifier when the result
 * lands in `node_modules` (same CJS/ESM-interop gap `importProjectModule`'s own `node_modules`
 * branch already guards against) — the two pieces of the resolution dance
 * {@linkcode importProjectDependency} needs twice, factored out so neither copy drifts from the
 * other. Returns a URL always safe to hand to native `import()` directly.
 *
 * **Except** when `specifier`'s base package is in `collisionPackages` (see
 * {@linkcode detectTransitiveCollisionPackages}'s own doc for what that set means and why): the
 * force-solve step is skipped entirely, returning the unexpanded `jsr:`/`http(s):` literal as-is.
 * This deliberately reintroduces the exact gap this function's own first paragraph closes
 * (`"minimumDependencyAge"` has no effect on the specifier this returns) for this one, narrow,
 * flagged case — see `resolveReplacement`'s matching branch for the full reasoning: a
 * pre-resolved, fixed URL for a package ALSO reachable as a transitive dependency of another
 * directly-imported package can silently diverge from whatever THAT package's own manifest
 * resolves the same name to, loading two separate module instances of it. Leaving it unexpanded
 * instead hands the real version-constraint solve to native `import()` itself, which — run under
 * {@linkcode prepareTransitiveCollisionReexec}'s re-exec'd process — sees both edges in the SAME
 * graph and unifies them the way any ordinary Deno project's dependency resolution already would. */
async function resolveProjectSpecifier(
  loader: Loader,
  referrerUrl: string,
  configPath: string | undefined,
  specifier: string,
  collisionPackages: Set<string>,
): Promise<string> {
  let resolved: string
  try {
    resolved = loader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
    const isUnresolvedLiteral = resolved.startsWith('jsr:') || resolved.startsWith('http:') ||
      resolved.startsWith('https:')
    if (isUnresolvedLiteral && collisionPackages.has(splitPackageSpecifier(specifier).base)) {
      return resolved
    }
    if (isUnresolvedLiteral) {
      await loader.addEntrypoints([resolved])
      resolved = loader.resolveSync(resolved, referrerUrl, ResolutionMode.Import)
    }
  } catch (error) {
    const literal = configPath ? reconstructSchemeSpecifier(configPath, specifier) : undefined
    if (literal === undefined) {
      throw new Error(
        `Could not resolve '${specifier}' relative to '${referrerUrl}': ${
          (error as Error).message
        }`,
      )
    }
    return literal
  }

  if (resolved.startsWith('file://') && resolved.includes('/node_modules/')) {
    const reconstructed = (configPath && reconstructSchemeSpecifier(configPath, specifier)) ??
      reconstructNpmSpecifierFromResolvedPath(resolved, specifier)
    return reconstructed ?? resolved
  }
  return resolved
}

/** Entries {@linkcode getAugmentedConfigPath} merges into a served project's own real
 * `deno.json(c)` — only when the project doesn't already declare its own — before
 * {@linkcode importProjectDependency} builds a `Loader` for it. `@zanix/server`/`@zanix/app`/
 * `@zanix/app/runtime` are `@zanix/space`'s OWN transitive dependencies (its manifest machinery,
 * its dev engine's route/server registries), never something a real generated project imports
 * directly — a pure `space` project's own `deno.json` declares NEITHER bare `@zanix/app` nor
 * `@zanix/server` at all (only `space-server` declares `@zanix/server`, and only for its own,
 * unrelated backend reasons — see `PROJECT_TYPE_DEPENDENCIES`, `utils/config/dependencies.ts`).
 * `@deno/loader`'s own `resolveSync` has no way to answer "what does `@zanix/space` itself resolve
 * `@zanix/server` to" directly — confirmed empirically (a real repro throws `Import "@zanix/app"
 * not a dependency` even when queried relative to `@zanix/space`'s own already-resolved URL, since
 * `Loader.resolveSync` only ever consults the WORKSPACE's own import map, never a resolved
 * package's own published one). The fix: declare the WIDEST possible range (`*`) for each here, so
 * `@deno/loader`'s own dependency-constraint solve has SOMETHING to unify against `@zanix/space`'s
 * own real need, once both are graphed together in the SAME `addEntrypoints` call — confirmed via
 * a real `deno info --json` repro that this converges on the IDENTICAL version `@zanix/space`
 * itself transitively resolves each of these to, never independently "the latest published
 * version": a project declaring `@zanix/space@^1.4.0` (whose own `deno.jsonc` pins
 * `@zanix/app@^1.0.0`) resolved a wildcard `@zanix/app@*` entry here to the exact same
 * `1.0.2` `@zanix/space`'s own internal dependency solved to, transitively, with NOTHING here
 * pinning that number. `@zanix/cli` therefore never tracks or bumps a version for any of these
 * three — the concrete version is entirely `@zanix/space`'s own call, for every install shape. */
const TRANSITIVE_ONLY_PACKAGES: Record<string, string> = {
  '@zanix/app': 'jsr:@zanix/app@*',
  '@zanix/server': 'jsr:@zanix/server@*',
  '@zanix/app/runtime': 'jsr:@zanix/app@*/runtime',
}

/** One in-memory result per REAL config path — same "compute once per process, reuse for every
 * later call" shape {@linkcode loadersByConfigPath} already establishes, so a project missing
 * NONE of {@linkcode TRANSITIVE_ONLY_PACKAGES} (nothing to augment) never re-reads/re-parses its
 * own config more than once, and a project missing some never writes more than one temp file. */
const augmentedConfigPathByRealPath = new Map<string, Promise<string | undefined>>()

/** Merges {@linkcode TRANSITIVE_ONLY_PACKAGES} into `root`'s own real `deno.json(c)` `imports` —
 * only the entries it doesn't already declare, so a `space-server` project's own real
 * `@zanix/server` pin (or any project's own explicit choice for any of the three) is read and left
 * completely untouched, never silently overridden — and writes the merged result to a real,
 * temporary sibling of the real config (same directory, so every relative `imports`/`scopes` value
 * the real file already declares keeps resolving against the SAME base it always has). Returns the
 * REAL config path unchanged when nothing needed merging at all (the common case for a
 * `space-server` project, which already declares `@zanix/server` itself) — no temp file, no
 * divergence from what {@linkcode importProjectModule}'s own `referrerLoader` resolves for
 * `space.app.ts`'s OWN bare specifiers, since both then share the identical `configPath` and,
 * through {@linkcode getLoaderFor}'s own cache, the identical `Loader`.
 *
 * The temp file itself is deleted immediately after {@linkcode getLoaderFor} has built a real
 * `Loader` from it — the SAME "write, use once, delete in this same process" discipline
 * `writeGeneratedModule`'s own temp files already follow (see that function's own doc): once a
 * `Workspace` has read a config file to build its `Loader`, the file's continued existence on disk
 * is never load-bearing again, and `getLoaderFor`'s own cache (keyed by this exact path) means the
 * file is read at most once regardless. Named with the same {@linkcode GENERATED_MODULE_PREFIX}
 * every other temp file this module writes shares, so a copy a killed process leaves behind is
 * swept the same way (see {@linkcode GENERATED_MODULE_MATCH}'s own doc) and already covered by
 * this project's own `.gitignore` (`ignore.base`'s `**\/.zanix-import-*` entry). */
function getAugmentedConfigPath(root: string): Promise<string | undefined> {
  const realConfigPath = findDenoConfigPath(root)
  if (!realConfigPath) return Promise.resolve(undefined)

  let pending = augmentedConfigPathByRealPath.get(realConfigPath)
  if (!pending) {
    pending = (async () => {
      let parsed: Record<string, unknown>
      try {
        parsed = parseJsonc(await Deno.readTextFile(realConfigPath)) as Record<string, unknown>
      } catch {
        // Genuinely unreadable/unparsable — not this function's own concern to surface; whatever
        // reads through this path next (resolveSync itself) throws its own, real error already.
        return realConfigPath
      }
      const existingImports = parsed.imports as Record<string, string> | undefined
      const imports = { ...existingImports }
      let changed = false
      for (const [pkg, literal] of Object.entries(TRANSITIVE_ONLY_PACKAGES)) {
        if (!(pkg in imports)) {
          imports[pkg] = literal
          changed = true
        }
      }
      if (!changed) return realConfigPath

      const augmentedPath = join(
        dirname(realConfigPath),
        `${GENERATED_MODULE_PREFIX}deps-${crypto.randomUUID()}.json`,
      )
      await Deno.writeTextFile(augmentedPath, JSON.stringify({ ...parsed, imports }))
      // Forces the Loader to read this file NOW, while building the cached Loader — its content is
      // fully captured in memory once this resolves, so the file itself is safe to delete
      // immediately after (see this function's own doc for why that matters).
      await getLoaderFor(augmentedPath)
      await Deno.remove(augmentedPath).catch(() => {})
      return augmentedPath
    })()
    augmentedConfigPathByRealPath.set(realConfigPath, pending)
  }
  return pending
}

/** Minimal shape of `deno info --json`'s own module graph output this file needs — a resolved
 * module's specifier and the resolved specifier of each of its own dependencies. Deliberately a
 * fresh, narrow local type rather than a shared one: `check-cycles/lib/graph.ts` has an equivalent
 * shape for its own, unrelated intra-repo-cycle concern, but importing across command boundaries
 * for a type this small would add a dependency neither command actually needs on the other. */
type DenoInfoModule = {
  specifier: string
  // `specifier` here is the raw, as-written import text (`'@zanix/server'`) — used to attribute
  // an edge back to the package base that declared it, by IDENTITY rather than by array
  // position (`deno info --json`'s own dependency-array order is not a documented guarantee).
  dependencies?: Array<{ specifier?: string; code?: { specifier?: string } }>
}
/** `redirects` maps every UNEXPANDED literal `deno info --json` encountered (`jsr:@zanix/server@
 * ^4.0.0`, the raw import-map/manifest-declared value) to its actual resolved module URL
 * (`https://jsr.io/@zanix/server/4.2.3/mod.ts`) — a dependency edge's own `code.specifier` is
 * frequently still the UNEXPANDED form (confirmed empirically: an open-range bare import stays
 * literal in `dependencies[]`, never eagerly resolved there), so every specifier this detection
 * collects must be run through this map before comparing/walking it as a real module identity. */
type DenoInfoOutput = { modules?: DenoInfoModule[]; redirects?: Record<string, string> }

/** Extracts a JSR package's `@scope/name` base and resolved version from one of its own module
 * URLs (`https://jsr.io/@scope/name/version/...`) — `undefined` for anything else (an `npm:`
 * specifier, a local `file://` path, `@std/*`, ...), which this detection has no need to track. */
const JSR_MODULE_URL_RE = /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\//

function jsrPackageBaseFromResolvedUrl(url: string): string | undefined {
  return JSR_MODULE_URL_RE.exec(url)?.[1]
}

/** One in-memory result per `root` — computed at most once per process, matching every other
 * cache in this file. */
const collisionPackagesByRoot = new Map<string, Promise<Set<string>>>()

/**
 * Detects every `@zanix/*` package base that `root`'s own project imports DIRECTLY (declared in
 * its own real `deno.json(c)` `"imports"`) and that is ALSO reachable as a dependency SOMEWHERE
 * inside a DIFFERENT package the project ALSO imports directly — e.g. a `space-server` project
 * declaring both `@zanix/server` (its own direct import) and `@zanix/datamaster` (whose own
 * published manifest depends on `jsr:@zanix/server@^4.0.0`).
 *
 * This is the real shape behind a confirmed bug: `@zanix/server` (or any package matching this
 * shape) can load as TWO separate module instances under a genuine global install, since native
 * `import()`'s dependency-constraint solve only ever unifies two edges for "the same" package when
 * BOTH are still-open, textually-bare specifiers reachable from the SAME running process's module
 * graph — a project's own direct edge, once eagerly pre-resolved to one fixed URL (today's default
 * — see {@linkcode resolveReplacement}/{@linkcode resolveProjectSpecifier}), and a third-party
 * package's OWN internal edge, resolved independently by whatever config governs the process
 * (nothing, under a real global install), can land on two different concrete versions even when
 * both ranges are semver-compatible. `instanceof` then fails across the two:
 * `ZanixCacheCoreProvider` (from `@zanix/datamaster`'s own internal `@zanix/server`) is not a
 * `ZanixProvider` (from the project's own, separately-resolved one).
 *
 * Purely STRUCTURAL — flags this shape regardless of whether the two edges happen to already
 * resolve to the same version today: a version bump on either side can split them apart later with
 * zero code change on the served project's own end (the same class of drift
 * `dev/validation.test.ts`'s own comments already document for `@zanix/space`). This is also what
 * makes the detection here reusable as a general, future-proof guard against ANY `@zanix/*`
 * "carrier" package a project imports directly — not a hardcoded list like
 * {@linkcode TRANSITIVE_ONLY_PACKAGES} (which solves a structurally different problem: `@zanix/space`'s
 * own 3 known transitive deps, never a THIRD-PARTY package's internal ones — see that constant's
 * own doc).
 *
 * Best-effort: returns an empty set (never throws) when the project has no config, fewer than two
 * direct `@zanix/*` imports (nothing that could collide), or the `deno info --json` probe itself
 * fails for any reason (network hiccup, an unpublished/unreachable package) — this detection is a
 * pure diagnostic aid, and must never be what blocks `zanix space dev`/`build` from starting.
 */
export function detectTransitiveCollisionPackages(root: string): Promise<Set<string>> {
  let pending = collisionPackagesByRoot.get(root)
  if (!pending) {
    pending = (async () => {
      const empty = new Set<string>()
      const configPath = findDenoConfigPath(root)
      if (!configPath) return empty

      let parsed: Record<string, unknown>
      try {
        parsed = parseJsonc(await Deno.readTextFile(configPath)) as Record<string, unknown>
      } catch {
        return empty
      }
      const imports = (parsed.imports as Record<string, string> | undefined) ?? {}
      const directBases = [
        ...new Set(
          Object.keys(imports)
            .filter((specifier) => specifier.startsWith('@zanix/'))
            .map((specifier) => splitPackageSpecifier(specifier).base),
        ),
      ]
      // Need at least two direct @zanix/* imports for one to possibly carry another transitively.
      if (directBases.length < 2) return empty

      const configDir = dirname(configPath)
      // `.js`, not `.ts` — plain `import 'pkg'` statements need no TypeScript syntax at all, and
      // `.js` is what GENERATED_MODULE_MATCH (sweepStaleGeneratedModules's own orphan-cleanup
      // regex) actually matches; a `.ts` orphan left behind by a killed process (before the
      // `finally` below removes it) would otherwise never be swept.
      const entryPath = join(
        configDir,
        `${GENERATED_MODULE_PREFIX}collision-check-${crypto.randomUUID()}.js`,
      )
      const entryUrl = toFileUrl(resolvePath(entryPath)).href
      await Deno.writeTextFile(
        entryPath,
        directBases.map((base) => `import ${JSON.stringify(base)}`).join('\n'),
      )

      let info: DenoInfoOutput
      try {
        const command = new Deno.Command(Deno.execPath(), {
          args: ['info', '--json', entryPath],
          cwd: configDir,
          stdout: 'piped',
          stderr: 'piped',
        })
        const { success, stdout } = await command.output()
        if (!success) return empty
        info = JSON.parse(new TextDecoder().decode(stdout)) as DenoInfoOutput
      } catch {
        return empty
      } finally {
        await Deno.remove(entryPath).catch(() => {})
      }

      const redirects = info.redirects ?? {}
      const resolveEdge = (specifier: string): string => redirects[specifier] ?? specifier

      const dependenciesBySpecifier = new Map<string, string[]>()
      for (const mod of info.modules ?? []) {
        dependenciesBySpecifier.set(
          mod.specifier,
          (mod.dependencies ?? [])
            .map((dep) => dep.code?.specifier)
            .filter((s): s is string => !!s)
            .map(resolveEdge),
        )
      }

      // Attributed by IDENTITY — each dependency's own raw `specifier` (`'@zanix/server'`) matched
      // back to the base it was declared for — never by array position/order, which `deno info
      // --json` documents no guarantee for.
      const entryModule = info.modules?.find((mod) => mod.specifier === entryUrl)
      const directRootByBase = new Map<string, string>()
      for (const dep of entryModule?.dependencies ?? []) {
        if (!dep.specifier || !dep.code?.specifier) continue
        const base = splitPackageSpecifier(dep.specifier).base
        if (directBases.includes(base)) directRootByBase.set(base, resolveEdge(dep.code.specifier))
      }
      if (directRootByBase.size !== directBases.length) return empty // resolution failed for one

      const collisions = new Set<string>()
      for (const [base] of directRootByBase) {
        for (const [otherBase, otherRoot] of directRootByBase) {
          if (otherBase === base || collisions.has(base)) continue
          // BFS from `otherBase`'s OWN root, looking for an edge whose package base is `base` —
          // i.e. `base` reachable transitively FROM a DIFFERENT direct import, not from itself.
          const seen = new Set<string>()
          const queue = [otherRoot]
          while (queue.length > 0) {
            const current = queue.shift() as string
            if (seen.has(current)) continue
            seen.add(current)
            if (jsrPackageBaseFromResolvedUrl(current) === base) {
              collisions.add(base)
              break
            }
            for (const dep of dependenciesBySpecifier.get(current) ?? []) queue.push(dep)
          }
        }
      }
      return collisions
    })()
    collisionPackagesByRoot.set(root, pending)
  }
  return pending
}

/** Guard env var a caller MUST set (to `'1'`, or any truthy string) on the re-exec'd child process
 * it spawns from a {@linkcode prepareTransitiveCollisionReexec} result, so that child never tries
 * to re-exec again for the same reason — detection is purely structural, independent of which
 * config governs the CURRENT process, so it would otherwise re-detect the identical collision set
 * every time and loop forever. Exported so `dev/action.ts`/`build/action.ts` set the exact same
 * name this function itself checks. */
export const TRANSITIVE_REEXEC_ENV = 'ZANIX_TRANSITIVE_COLLISION_REEXEC'

/**
 * Returns the `--config` path `zanix space dev`/`build`'s own startup should re-exec the WHOLE
 * process with, or `undefined` when no re-exec is needed — either because
 * {@linkcode detectTransitiveCollisionPackages} found no collision risk for `root`, or because
 * THIS process is already the re-exec'd child (guarded via {@linkcode TRANSITIVE_REEXEC_ENV}).
 *
 * A re-exec, not an in-process fix, because native `import()` resolves a bare specifier against
 * whatever import map governs the WHOLE running process — fixed once, at startup, from
 * `Deno.mainModule`'s own config, never re-discovered per dynamically-imported file's own
 * directory (confirmed empirically: a process started with an unrelated/no config cannot resolve a
 * served project's own bare specifier no matter which directory the imported file lives in). Once
 * {@linkcode resolveReplacement}/{@linkcode resolveProjectSpecifier} stop eagerly pre-resolving a
 * flagged package's specifier (their own matching branches), nothing short of restarting the
 * process under the served project's own config lets that now-bare specifier resolve at all.
 *
 * The returned config MERGES `@zanix/cli`'s OWN `"imports"` ({@linkcode getCliConfigPath}, only
 * ever defined during a local checkout — `undefined`, i.e. nothing to merge, under a real global
 * install) with the served project's own — the project's own entries win on any key collision —
 * so a re-exec never breaks `@zanix/cli`'s own internal path aliases (`'cli'`, `commands/...`,
 * `typings/`, ...) while still letting the project's own direct imports resolve. Written as a real,
 * temporary sibling of the project's own config (same {@linkcode GENERATED_MODULE_PREFIX}
 * convention as {@linkcode getAugmentedConfigPath}'s own temp files); left on disk for
 * {@linkcode sweepStaleGeneratedModules} to clean up on a later run, since it needs to keep
 * existing for the re-exec'd process's entire lifetime, not just until this function returns.
 */
export async function prepareTransitiveCollisionReexec(root: string): Promise<string | undefined> {
  if (Deno.env.get(TRANSITIVE_REEXEC_ENV)) return undefined

  const collisions = await detectTransitiveCollisionPackages(root)
  if (collisions.size === 0) return undefined

  const configPath = findDenoConfigPath(root)
  if (!configPath) return undefined

  let projectParsed: Record<string, unknown>
  try {
    projectParsed = parseJsonc(await Deno.readTextFile(configPath)) as Record<string, unknown>
  } catch {
    return undefined
  }

  let cliImports: Record<string, string> = {}
  const cliConfigPath = getCliConfigPath()
  if (cliConfigPath) {
    try {
      const cliParsed = parseJsonc(await Deno.readTextFile(cliConfigPath)) as Record<
        string,
        unknown
      >
      const rawCliImports = (cliParsed.imports as Record<string, string> | undefined) ?? {}
      // A RELATIVE value (`"commands/": "./src/commands/"`, cli's own internal path aliases —
      // real, confirmed against `@aeratech/console`: without this anchoring, the merged config
      // (written as a sibling of the SERVED PROJECT's own config, per this function's own doc)
      // resolves that SAME relative text against the PROJECT's own directory instead of cli's,
      // throwing `Module not found ".../<project>/src/commands/new/main.ts"` the moment cli's own
      // internal `commands/new/main.ts`-style import runs) is rewritten to an absolute `file://`
      // URL anchored at `cliConfigPath`'s OWN directory — exactly what `deno.json(c)` "imports"
      // already does natively for a relative value, just computed here instead of left to Deno's
      // own (config-file-relative, not merged-file-relative) resolution. A scheme-based value
      // (`jsr:`/`npm:`/`https:`) needs no anchoring at all and is kept as-is.
      const cliConfigDir = dirname(cliConfigPath)
      cliImports = Object.fromEntries(
        Object.entries(rawCliImports).map(([key, value]) => {
          if (!value.startsWith('./') && !value.startsWith('../')) return [key, value]
          // `resolvePath`/`toFileUrl` both normalize away a trailing slash — re-appended when the
          // original value had one, since a folder-prefix mapping (`"commands/": "./src/commands/"`)
          // needs it on BOTH sides to keep Deno's own prefix-matching semantics, not just resolve
          // to a single, non-existent file path.
          const anchored = toFileUrl(resolvePath(cliConfigDir, value)).href
          return [key, value.endsWith('/') ? `${anchored}/` : anchored]
        }),
      )
    } catch {
      // Best-effort — a missing/unreadable cli config just means nothing to merge from it.
    }
  }

  const projectImports = (projectParsed.imports as Record<string, string> | undefined) ?? {}
  const mergedImports = { ...cliImports, ...projectImports }

  const mergedPath = join(
    dirname(configPath),
    `${GENERATED_MODULE_PREFIX}reexec-${crypto.randomUUID()}.json`,
  )
  await Deno.writeTextFile(mergedPath, JSON.stringify({ ...projectParsed, imports: mergedImports }))
  return mergedPath
}

/**
 * Imports a BARE package specifier (`@zanix/space`, `@zanix/space/dev`, `@zanix/server`,
 * `@zanix/app`, `@zanix/app/runtime`) — never a project FILE, see {@linkcode importProjectModule}
 * for that — resolved against `root`'s own nearest `deno.json(c)`, and returns its module
 * namespace.
 *
 * Exists for the same reason `importProjectModule` resolves a project FILE's own bare specifiers
 * against that project's config instead of `@zanix/cli`'s: `@zanix/cli` itself natively imports
 * `@zanix/space`/`@zanix/app`/`@zanix/server` for its own dev/build orchestration
 * (`createSpaceDevEngine`, `activateApps`, `bootstrapServers`, ...), and shares real, module-level
 * protocol state through them with whatever the served project's own `space.app.ts` imports (a
 * renderer registry, a route registry, ...). A plain `import('@zanix/space/dev')` from inside
 * `@zanix/cli`'s own process resolves against WHATEVER config governs that already-running
 * process — for a real global install, the shim's own separately generated, fixed lockfile,
 * completely independent of any served project's own declared version. When that diverges from
 * what the project itself resolves through `importProjectModule`, Deno loads TWO separate module
 * instances of the same package: `SpaceDevSocket`'s own static class initializer runs once per
 * instance, each registering the identical dev-socket route into `@zanix/server`'s ONE shared
 * route registry — the second registration throws `Route path "socket=>/__zanix_space_dev__" is
 * already defined`. Resolving `@zanix/cli`'s own native orchestration imports THROUGH this
 * function instead converges both onto the identical resolved URL (and therefore the identical
 * Deno module-cache key), with no floor for `@zanix/cli` to keep in sync at all: it simply never
 * holds an opinion on these packages' version, in any install shape.
 *
 * `@zanix/space` itself (bare, or a subpath like `@zanix/space/dev`) resolves relative to
 * `space.app.ts` — the one file every real project is guaranteed to both have and directly import
 * `@zanix/space` from. `@zanix/server`/`@zanix/app`/`@zanix/app/runtime` do NOT reliably (see
 * {@linkcode TRANSITIVE_ONLY_PACKAGES}'s own doc) — resolving them against `space.app.ts` as
 * referrer would therefore fail "not a dependency and not in import map" on a real, correctly
 * configured `space` project, a strictly worse regression than the bug this function exists to
 * fix. {@linkcode getAugmentedConfigPath} closes that gap: `@zanix/space` is always graphed FIRST,
 * via `resolveProjectSpecifier`'s own `addEntrypoints` call, on the SAME `Loader` the augmented
 * config built — establishing the real dependency-constraint solve `@zanix/space`'s own manifest
 * participates in — so resolving `@zanix/server`/`@zanix/app`/`@zanix/app/runtime` immediately
 * after, on that SAME loader, correctly unifies with whatever `@zanix/space` itself transitively
 * needs, per that constant's own doc.
 *
 * No relative-import rewriting, no {@linkcode ImportBatchContext} — unlike a real project FILE, a
 * bare package specifier has no relative imports of its own to recurse into or dedupe against a
 * batch.
 */
export async function importProjectDependency(
  root: string,
  specifier: string,
): Promise<Record<string, unknown>> {
  const configPath = await getAugmentedConfigPath(root)
  const loader = await getLoaderFor(configPath)
  const manifestReferrer = toFileUrl(resolvePath(root, PROJECT_MANIFEST_FILE)).href
  const collisionPackages = await detectTransitiveCollisionPackages(root)

  // Always graph @zanix/space FIRST, on THIS loader — every other package this function ever
  // resolves is either @zanix/space itself or one of its own transitive dependencies, and the
  // unification TRANSITIVE_ONLY_PACKAGES's own doc describes only happens correctly once both are
  // part of the SAME addEntrypoints solve, in this order. A no-op extra round-trip when `specifier`
  // IS `@zanix/space` itself — harmless, and simpler than special-casing it away.
  await resolveProjectSpecifier(
    loader,
    manifestReferrer,
    configPath,
    '@zanix/space',
    collisionPackages,
  )

  const resolved = await resolveProjectSpecifier(
    loader,
    manifestReferrer,
    configPath,
    specifier,
    collisionPackages,
  )
  return await import(resolved) as Record<string, unknown>
}

interface SpecifierMatch {
  start: number
  end: number
  specifier: string
  /** Whether `[start, end)` already includes the specifier's own surrounding quotes.
   * `es-module-lexer` reports a static import/export's specifier span WITHOUT quotes, but a
   * dynamic `import(...)` call's span WITH them (it generically spans the whole call argument
   * expression, which for a plain string literal happens to include its delimiters) — the
   * splice step needs to know which shape it's replacing. */
  quoted: boolean
}

/** Every import/export/dynamic-import specifier in already-transpiled `code`, found with a real
 * JS lexer (`es-module-lexer` — the same one Vite/Rollup use internally for this exact job)
 * rather than a hand-rolled regex/comment scanner. This matters for real, not just in theory: a
 * text-based scan mistakes a doc comment's own EXAMPLE code (`* import { x } from '@some/pkg'`),
 * or a plain string value elsewhere in the file that merely LOOKS like an import statement (an
 * error message quoting `import 'x'` as sample text), for a genuine specifier — both false
 * positives were caught against real `@zanix/space` source before this module ever shipped.
 *
 * A dynamic `import(...)` whose argument isn't a plain string literal (a template literal with
 * interpolation, a computed expression) reports no specifier at all and is silently skipped —
 * see this module's own doc for why that's a deliberate, harmless limitation. */
function findSpecifierMatches(code: string): SpecifierMatch[] {
  const [imports] = parseEsModule(code)
  const matches: SpecifierMatch[] = []
  for (const imp of imports) {
    if (imp.n === undefined) continue
    matches.push({ start: imp.s, end: imp.e, specifier: imp.n, quoted: imp.d > -1 })
  }
  return matches
}

/**
 * A shared dedup context for a BATCH of independent {@linkcode importProjectModule} top-level
 * calls that may reach EACH OTHER through their own relative imports — e.g. a `defineLocalMetadata`
 * -style directory scan (`@zanix/server`'s own module-file convention: `.handler.ts`/
 * `.interactor.ts`/`.provider.ts`/`.connector.ts`/`.defs.ts`, each discovered and imported
 * independently, yet frequently importing one another by relative path within the same folder —
 * the normal shape a handler resolving `this.interactors.get(SomeInteractor)` needs `SomeInteractor`
 * imported into scope somehow). Without a SHARED context, calling {@linkcode importProjectModule}
 * once per discovered file gives each call its OWN private `cache`/`tempFiles` — a file reached
 * BOTH directly (the scan's own top-level entry) AND indirectly (via another entry's relative
 * import) would be rewritten and natively `import()`-ed TWICE, as two DIFFERENT class objects for
 * the exact same source — silently splitting DI container identity for anything with no custom
 * `slot` (see `@zanix/server`'s own `registerCustomProviderSlotAlias` doc for that mechanism, and
 * why it doesn't save this case on its own). A plain native `import()` of the same real file path
 * never has this problem — Deno's own ES module cache dedupes by URL automatically — but every
 * {@linkcode importProjectModule} call writes its OWN fresh temp file per rewrite, a NEW url each
 * time, unless the SAME `cache` decides "already rewritten, reuse that url" across every call
 * sharing it.
 *
 * Create one via {@linkcode createImportBatchContext}, pass it to every
 * {@linkcode importProjectModule} call in the batch, then call {@linkcode cleanupImportBatch}
 * exactly once, after every call in the batch has settled — never per call, and never omitted
 * (nothing else ever revisits an orphaned temp file from a batch that skipped this).
 */
export interface ImportBatchContext {
  cache: Map<string, Promise<string>>
  inProgress: Set<string>
  tempFiles: string[]
}

/** A fresh, empty {@linkcode ImportBatchContext} — see that type's own doc. */
export function createImportBatchContext(): ImportBatchContext {
  return { cache: new Map(), inProgress: new Set(), tempFiles: [] }
}

/** Removes every temp file a batch's {@linkcode importProjectModule} calls wrote — call exactly
 * once, after every call sharing `context` has settled. Best-effort, same as the single-call
 * cleanup this mirrors: a single file's own removal failing is silently swallowed. */
export async function cleanupImportBatch(context: ImportBatchContext): Promise<void> {
  await Promise.all(context.tempFiles.map((path) => Deno.remove(path).catch(() => {})))
}

/**
 * Imports `filePath` — an absolute path to a file belonging to a consuming project — resolving
 * its own bare specifiers (and those of every file it relatively imports) against that project's
 * own nearest `deno.json(c)`. See this module's own doc for the full mechanism.
 *
 * Every file this recurses into gets ITS OWN nearest config looked up fresh — never the entry
 * file's config reused wholesale. A local specifier can genuinely cross into a DIFFERENT project
 * mid-graph (a workspace sibling, or a project's own local-path override pointing outside its own
 * directory tree, e.g. `@zanix/space` mapped to a linked `../space/mod.ts` checkout) — that
 * sibling's own bare specifiers must resolve against ITS OWN `deno.json(c)`, not the entry's.
 *
 * @param batchContext - Omit for a single, self-contained call (the default — builds its own
 * fresh context and cleans up its own temp files before returning, exactly as before this
 * parameter existed). Pass a shared {@linkcode ImportBatchContext} when calling this once per file
 * across a BATCH of independent entries that may reach each other — see that type's own doc for
 * why, and its own doc for the cleanup contract this shifts onto the caller in that case.
 */
export async function importProjectModule(
  filePath: string,
  batchContext?: ImportBatchContext,
): Promise<Record<string, unknown>> {
  const entryUrl = toFileUrl(resolvePath(filePath)).href

  const ownsContext = !batchContext
  const { cache, inProgress, tempFiles } = batchContext ?? createImportBatchContext()

  /** Whether a `file://` recursion candidate is genuinely part of a project's own governed
   * source (or a linked/workspace sibling with its own config) rather than vendored third-party
   * code already materialized on disk. See this module's own doc for why two checks are needed. */
  function isRecursable(resolvedPath: string): boolean {
    if (resolvedPath.includes('/node_modules/')) return false
    return findDenoConfigPath(dirname(resolvedPath)) !== undefined
  }

  async function resolveReplacement(
    specifier: string,
    referrerUrl: string,
    referrerConfigPath: string | undefined,
    referrerLoader: Loader,
  ): Promise<string> {
    if (SCHEME_RE.test(specifier)) return specifier

    // A relative/absolute specifier is pure path math — always the SAME target regardless of
    // which config governs it — so there's no "does this diverge from cli's own resolution"
    // question to ask here; a file reached this way is recursed into unconditionally when it
    // qualifies (`isRecursable`), the same as ever.
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const resolved = new URL(specifier, referrerUrl).href
      if (!resolved.startsWith('file://') || !isRecursable(fromFileUrl(resolved))) return resolved
      return await process(resolved)
    }

    // A bare specifier `@zanix/cli`'s OWN configuration can ALSO resolve — to ANY target, even
    // one that genuinely differs from what the project's own config would give — resolves against
    // `cli`'s OWN config instead. This matters for real reasons, not just as an optimization: some
    // packages are not only a project's own dependency — `@zanix/cli` ITSELF imports them natively
    // for its own orchestration and shares real, module-level protocol state through them with
    // whatever `space.app.ts` imports (a renderer registry, a route registry, ...). Resolving the
    // specifier against the PROJECT's own config instead — even to a genuinely valid, different
    // target — loads a SEPARATE module instance of that package, silently breaking that shared
    // state. Only a specifier `@zanix/cli` genuinely has no answer for at all falls through to the
    // project's own resolution below.
    //
    // `@zanix/space`/`@zanix/app`/`@zanix/server` are the historical motivating case for this
    // whole step — but `cli` no longer holds a separate native instance of any of them at all (see
    // {@linkcode PROJECT_ANCHORED_ONLY_PACKAGES}'s own doc), so this step is skipped entirely for
    // those three, falling straight through to the project's own resolution below exactly as if
    // `cli`'s config had no answer at all.
    const packageBase = splitPackageSpecifier(specifier).base
    if (!PROJECT_ANCHORED_ONLY_PACKAGES.has(packageBase)) {
      const cliLoader = await getCliLoader()
      try {
        let cliResolved = cliLoader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
        // A `jsr:`/`http(s):` result from `resolveSync` ALONE is an UNEXPANDED literal (e.g. still
        // `jsr:@zanix/space@^X.Y.Z`, the raw import-map value, not a real resolved version) — splicing
        // that literal into the temp file below would let native `import()` perform its OWN,
        // SEPARATE version-range resolution at runtime, which can land on a DIFFERENT actual version
        // than whatever `cli`'s own static `@zanix/space` import resolved to, reintroducing the exact
        // "two separate SpaceDevSocket instances" failure this whole deferral exists to prevent, just
        // one level deeper than the false-positive case {@linkcode resolvesIntoCliOwnSourceTree}
        // already guards against. `@zanix/space`'s own `resolveDenoAt` (`deno-optimize-deps-alias.ts`)
        // solves the identical problem the identical way: `addEntrypoints` forces the real
        // dependency-constraint solve, then a second `resolveSync` on the now-graphed literal returns
        // the real, canonical resolved URL — which, sharing the exact same `cliLoader`/lockfile state
        // `cli`'s own internal imports resolve through, converges on the identical module-cache key.
        // `resolveSync('@zanix/space', ...)` alone returns the literal `jsr:@zanix/space@^X.Y.Z`;
        // only after `addEntrypoints` does it return a real version, e.g.
        // `https://jsr.io/@zanix/space/X.Y.Z/mod.ts`. A `file://` result needs none of this — it's
        // already a real, concrete path. This resolved version must always match this file's own
        // `"@zanix/space"` import-map entry EXACTLY (kept in sync by hand, not derived): if
        // `@zanix/space` publishes a newer version than what's pinned here, this fresh lookup
        // returns that newer version while `cli`'s own statically-locked import (governed by
        // whatever lockfile the running process was installed with) stays pinned to the older one,
        // splitting identity anyway despite this whole mechanism.
        if (
          cliResolved.startsWith('jsr:') || cliResolved.startsWith('http:') ||
          cliResolved.startsWith('https:')
        ) {
          await cliLoader.addEntrypoints([cliResolved])
          cliResolved = cliLoader.resolveSync(cliResolved, referrerUrl, ResolutionMode.Import)
        }
        // EXCEPT when that resolution lands inside `cli`'s OWN hand-written source tree
        // ({@linkcode resolvesIntoCliOwnSourceTree}) — a false positive of the check above, never
        // the genuine identity-sharing case it exists for: `cli`'s own internal folder aliases
        // (`typings/`, `shared/`, `utils/` → `./src/{typings,shared,utils}/`, declared purely for
        // `cli`'s OWN source to use short bare-specifier imports internally) share their EXACT names
        // with the aliases `zanix new` scaffolds into every consuming project — so a project file's
        // own `import 'utils/constants.ts'` resolves "successfully" here too, but against `cli`'s
        // OWN `src/utils/constants.ts`, never the project's. Falls through to the project's own
        // resolution below instead, exactly as if `cli`'s config had no answer at all — see that
        // function's own doc for the full account.
        //
        // A SECOND, deeper case of the identical false-positive shape — see
        // {@linkcode cliLoaderHasNoRealLocalAnswer}'s own doc for the full account — surfaces as
        // `Import "clients/registry-hub.client.ts" not a dependency`, thrown from the ORIGINAL
        // `triggers.interactor.ts`: reached this way after `page.tsx`'s own
        // `import ... from 'triggers/triggers.interactor.ts'` resolves through this exact branch and
        // returns unrecursed.
        if (
          !cliLoaderHasNoRealLocalAnswer(cliConfigPath, cliResolved) &&
          !resolvesIntoCliOwnSourceTree(cliResolved)
        ) {
          // The resolved, fully-qualified URL — never the original bare `specifier` — is what gets
          // spliced into the rewritten temp file below. `writeGeneratedModule`'s temp file is a LOOSE
          // file living in the PROJECT's own directory, not part of any package's own module graph —
          // a bare specifier only resolves for it via whatever import map governs the WHOLE running
          // `deno` process (nearest-config discovery from a local checkout, or an explicit `--config`
          // at process startup), never `cli`'s own config specifically. Under `deno install -g` (no
          // matching entry in whatever config the shim forces process-wide), that process-wide map
          // has no answer for `@zanix/space`/`@zanix/app`/`@zanix/server` at all — native `import()`
          // of the temp file then throws `Import "@zanix/space" not a dependency` on every real
          // global install, even though `cliLoader` above already resolved it successfully one line
          // up. Splicing in `cliResolved` sidesteps the need for any import map at all — a
          // fully-qualified specifier resolves identically regardless of which config governs the
          // process — while still preserving the shared module instance the surrounding comment's
          // `SpaceDevSocket` case depends on: Deno's module cache keys by resolved URL, not by which
          // import statement reached it, and `@deno/loader`'s own `resolveSync` mirrors Deno's native
          // resolution algorithm by design, so the two converge on the identical cache key.
          //
          // EXCEPT a raw `file://` path straight into `node_modules` — the same CJS/ESM-interop gap
          // the project-anchored `node_modules` branch further down already guards against (see its
          // own doc): react's own CJS entry is a runtime
          // `if (process.env.NODE_ENV === 'production') { ... } else { ... }` conditional `require`,
          // which Deno's static CJS→ESM named-export analysis can't see through — a raw `file://`
          // import of it exposes NO named exports at all, so `import { jsx } from
          // 'react/jsx-runtime'` fails outright even though the file resolved successfully.
          // Reconstructing the scheme-based specifier form instead (`npm:react@^X.Y.Z/jsx-runtime`)
          // hands native `import()` the same text a normal static import would have used, with full
          // npm CJS/ESM interop intact — using `cliConfigPath` here, never `referrerConfigPath`: the
          // import-map entry being reconstructed is `cli`'s own, not the project's.
          //
          // `reconstructSchemeSpecifier` needs a real config FILE to read (`cliConfigPath`), which is
          // `undefined` for any genuine global install (never a local checkout — see `getCliLoader`'s
          // own doc), so it silently no-ops on every real-world case that needs it.
          // `reconstructNpmSpecifierFromResolvedPath` is the real fallback for exactly that case: it
          // needs no config file at all, parsing the version straight out of `cliResolved` itself via
          // Deno's own npm-cache directory convention.
          if (cliResolved.startsWith('file://') && cliResolved.includes('/node_modules/')) {
            const reconstructed =
              (cliConfigPath && reconstructSchemeSpecifier(cliConfigPath, specifier)) ??
                reconstructNpmSpecifierFromResolvedPath(cliResolved, specifier)
            return reconstructed ?? cliResolved
          }
          return cliResolved
        }
      } catch {
        // Reconstructs the scheme-based specifier form when `reconstructSchemeSpecifier` can produce
        // one, rather than falling back to the ORIGINAL bare `specifier` — the same "no import map
        // for a loose temp file" failure the `!resolvesIntoCliOwnSourceTree` branch above already
        // guards against, just in this error-fallback path instead of the main one. Returns the
        // reconstructed scheme literal itself — the same canonical text a normal static import would
        // have resolved through, resolvable with no import map at all, exactly like the identical
        // pattern the project-anchored fallback below already uses.
        const reconstructed = cliConfigPath
          ? reconstructSchemeSpecifier(cliConfigPath, specifier)
          : undefined
        if (reconstructed !== undefined) return reconstructed
        // `@zanix/cli`'s own config has nothing for this specifier at all — falls through.
      }
    }

    let resolved: string
    try {
      resolved = referrerLoader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
      // Same class of gap as `cliLoader`'s own identical fix above, applied here for a DIFFERENT
      // reason: a `jsr:`/`http(s):` result from `resolveSync` ALONE is an unexpanded literal (the
      // raw import-map value, not a real resolved version) — e.g.
      // `referrerLoader.resolveSync('@zanix/auth', ...)` (against a real project's own config)
      // returns the literal `jsr:@zanix/auth@^X.Y.Z`, not a resolved version. Splicing that literal
      // in directly hands the ACTUAL version-range resolution to native `import()` at RUNTIME —
      // governed by whatever config/lockfile the PROCESS itself was started with, never
      // `referrerLoader`'s own `newestDependencyDate` ({@linkcode readNewestDependencyDate}) — so a
      // project's own `"minimumDependencyAge"` setting, despite correctly configuring
      // `referrerLoader` itself, has NO effect on the specifier this branch actually splices in:
      // `Could not find version of '@zanix/auth' that matches specified version constraint
      // '^X.Y.Z' ... newer than the specified minimum dependency date`, even with
      // `"minimumDependencyAge": 0` set in the project's own `deno.json`. Forcing the real
      // dependency-constraint solve HERE, through `referrerLoader` (which DOES already carry the
      // project's own correct age-gate cutoff), produces a fully-resolved absolute URL that needs
      // no further native resolution at all — closing the gap completely, not working around it.
      //
      // **Except** when `specifier`'s base package is a detected transitive-collision risk (see
      // {@linkcode detectTransitiveCollisionPackages}'s own doc): the force-solve step is skipped,
      // deliberately reintroducing the `"minimumDependencyAge"` gap this comment just described,
      // for this one narrow case — a package ALSO reachable as another directly-imported package's
      // own transitive dependency needs to stay an unexpanded, still-open specifier so native
      // `import()` (run under {@linkcode prepareTransitiveCollisionReexec}'s re-exec'd process) can
      // unify it with that other edge itself, instead of two independently-fixed URLs silently
      // diverging into two separate module instances.
      const isUnresolvedLiteral = resolved.startsWith('jsr:') || resolved.startsWith('http:') ||
        resolved.startsWith('https:')
      const isCollisionRisk = isUnresolvedLiteral && referrerConfigPath !== undefined &&
        (await detectTransitiveCollisionPackages(dirname(referrerConfigPath))).has(
          splitPackageSpecifier(specifier).base,
        )
      if (isUnresolvedLiteral && !isCollisionRisk) {
        await referrerLoader.addEntrypoints([resolved])
        resolved = referrerLoader.resolveSync(resolved, referrerUrl, ResolutionMode.Import)
      }
    } catch (error) {
      // The one real gap `resolveSync` has on its own: an `npm:`-mapped bare specifier needs a
      // real dependency-constraint solve (`Loader.addEntrypoints`) to resolve at all — never run
      // here (see `readImportMapValue`'s own doc for why). Reconstructing the project's own
      // scheme literal for `specifier`, when one is declared, hands native `import()` the exact
      // same scheme text a normal static import would have resolved through, with full interop
      // intact.
      const literal = referrerConfigPath
        ? reconstructSchemeSpecifier(referrerConfigPath, specifier)
        : undefined
      if (literal !== undefined) return literal
      throw new Error(
        `Could not resolve '${specifier}' imported from '${fromFileUrl(referrerUrl)}' against '${
          referrerConfigPath ?? '(no project deno.json found)'
        }': ${(error as Error).message}`,
      )
    }

    if (!resolved.startsWith('file://')) return resolved
    const resolvedPath = fromFileUrl(resolved)

    if (resolvedPath.includes('/node_modules/')) {
      // `resolveSync` can succeed here WITHOUT throwing — once a real `node_modules` tree already
      // exists on disk (a project that's already been installed/run once), Node-style resolution
      // finds an already-materialized file directly, no dependency-constraint solve needed. But a
      // raw `file://` path straight into `node_modules` bypasses Deno's own CJS/ESM interop just
      // the same as the constraint-solve-failure case above: a bare `'react/jsx-runtime'` resolved
      // this way reads as a plain ESM re-export with no `jsx` named export, where the real
      // npm-specifier form resolves and interops correctly — reconstructed the same way, for the
      // same reason. `referrerConfigPath` is `undefined` only in the
      // genuinely rare case of no `deno.json(c)` anywhere in this file's own ancestry — falls back
      // to the same config-free reconstruction the `cliLoader` branch above needs unconditionally
      // (see {@linkcode reconstructNpmSpecifierFromResolvedPath}'s own doc for why that one can
      // never rely on a config file at all under a real global install).
      const reconstructed =
        (referrerConfigPath && reconstructSchemeSpecifier(referrerConfigPath, specifier)) ??
          reconstructNpmSpecifierFromResolvedPath(resolved, specifier)
      return reconstructed ?? resolved
    }

    if (!isRecursable(resolvedPath)) return resolved
    return await process(resolved)
  }

  /** Writes `code` as a real, temporary sibling of `fileUrl` — never a `blob:`/`data:` URL, unless
   * the original file's own directory isn't writable. This matters for real, not just tidy,
   * reasons: a module that computes `new URL('./sibling.ts', import.meta.url)` at its own top level
   * (a genuine, real pattern — `@zanix/space`'s own default error-view resolution does exactly
   * this) needs that call to land on the REAL sibling file, which only works when the executing
   * module's own location is a real path in the REAL directory the sibling actually lives in — a
   * `blob:` base has no meaningful hierarchical structure for relative resolution to work against
   * at all, throwing `TypeError: Invalid URL` against a real `@zanix/space` source module that
   * relies on it. Shared between the main JS-rewrite path below and the non-JS stub path
   * ({@linkcode process}'s own `JS_MEDIA_TYPES` branch) — both need the exact same real-sibling-
   * file guarantee, for the same reason. */
  async function writeGeneratedModule(fileUrl: string, code: string): Promise<string> {
    const originalPath = fromFileUrl(fileUrl)
    const tempPath = join(
      dirname(originalPath),
      `${GENERATED_MODULE_PREFIX}${crypto.randomUUID()}.js`,
    )
    try {
      // A single-line header, deliberately — a multi-line one would shift every later line's own
      // number away from the ORIGINAL file's own line count by more than one, making a real syntax
      // error's reported line/column harder to map back by hand. A project's own `.gitignore`
      // already excludes `.zanix-import-*.js` (see `ignore.base`'s own doc) — this header is purely
      // for the rare case one survives anyway (a killed process skips the `finally` cleanup below),
      // so whoever finds it stray in their own project tree knows it's safe to delete, not their own
      // accidentally-committed file.
      const annotated =
        `/* AUTO-GENERATED by @zanix/cli's \`zanix space dev\`/\`zanix space build\` — a temporary, rewritten sibling of '${
          originalPath.split('/').pop()
        }` +
        ', deleted the instant the import that created it resolves. Safe to delete by hand if you ever see one left behind' +
        ' (only a killed process leaves one). Never meant to be committed — see .gitignore. */\n' +
        code
      await Deno.writeTextFile(tempPath, annotated)
      tempFiles.push(tempPath)
      return toFileUrl(tempPath).href
    } catch {
      // The original file's own directory isn't writable (a read-only mount, for instance) — falls
      // back to a `blob:` URL: bare-specifier resolution still works correctly, only an
      // `import.meta.url`-relative reference inside THIS specific file would misbehave, which is
      // strictly better than failing the whole import outright.
      const blob = new Blob([code], { type: 'application/javascript' })
      return URL.createObjectURL(blob)
    }
  }

  function process(fileUrl: string): Promise<string> {
    const cached = cache.get(fileUrl)
    if (cached) return cached
    if (inProgress.has(fileUrl)) {
      throw new Error(
        `Circular local import involving '${fromFileUrl(fileUrl)}' — this cannot be resolved ` +
          "against the project's own configuration.",
      )
    }

    const promise = (async () => {
      inProgress.add(fileUrl)
      try {
        const configPath = findDenoConfigPath(dirname(fromFileUrl(fileUrl)))
        const loader = await getLoaderFor(configPath)

        let response
        try {
          response = await loader.load(fileUrl, RequestedModuleType.Default)
        } catch (error) {
          throw new Error(
            `Could not load '${fromFileUrl(fileUrl)}': ${(error as Error).message}`,
          )
        }
        if (response.kind !== 'module') {
          return fileUrl
        }
        if (!JS_MEDIA_TYPES.has(response.mediaType)) {
          // A relative import reaching a non-JS asset is left alone in every OTHER respect (no
          // resolution ambiguity to fix here, see this module's own doc) — but the PARENT file's
          // own static import statement still names this exact file, unconditionally evaluated the
          // moment native `import()` runs it (ESM gives a static import no way to opt out of
          // loading). Two media types get a real stub instead of the untouched `fileUrl` below,
          // because native `import()` cannot load either one on its own at all: a Comet's own
          // `*.module.css` import, reachable through a page this function recurses into for
          // `discoverPages`'s own build-time discovery pass (see `discoverPages`'s own
          // `importModule` option, `@zanix/space`), throws Deno's own "Expected a JavaScript or
          // TypeScript module, but identified a Css module" the instant the rewritten temp file's
          // own `import` statement runs. A stub is safe here specifically because nothing at THIS
          // level ever needs the real value: this function exists only to let a file's static shape
          // (a page's `head`/`redirect`, a decorator's own metadata, ...) be read back — never to
          // actually RENDER a component, the only place a Comet's own CSS Modules mapping would
          // ever matter for real.
          if (response.mediaType === MediaType.Css) {
            return await writeGeneratedModule(fileUrl, 'export default {}\n')
          }
          if (JSON_MEDIA_TYPES.has(response.mediaType)) {
            // Real content, not an empty stub — mirrors `@deno/vite-plugin`'s own identical fix for
            // the same problem (`resolvePlugin.js`'s `mediaType === 'Json'` branch): a `.json`
            // import's value is far more likely to be read for real than a CSS Modules mapping is.
            const json = new TextDecoder().decode(response.code)
            return await writeGeneratedModule(fileUrl, `export default ${json}\n`)
          }
          // Every OTHER non-JS media type (HTML, Markdown, SQL, Wasm, ...) has no real usage
          // reaching this function yet — handed to `import()` using its own resolved path
          // unchanged, rather than guessing at a stub shape with nothing to model it against.
          return fileUrl
        }

        let code = new TextDecoder().decode(response.code)
        const matches = findSpecifierMatches(code)
        const replacements = await Promise.all(
          matches.map(async (match) => ({
            ...match,
            replacement: await resolveReplacement(match.specifier, fileUrl, configPath, loader),
          })),
        )
        // Applied back-to-front so every earlier offset stays valid as later ones are spliced in.
        for (
          const { start, end, replacement, quoted } of replacements.sort((a, b) =>
            b.start - a.start
          )
        ) {
          // A static import/export's span excludes its quotes (the originals stay in the code
          // untouched); a dynamic `import(...)` call's span includes them (see `SpecifierMatch`'s
          // own doc), so the replacement needs its own quoting — `JSON.stringify` also escapes
          // anything the replacement text itself might need escaped.
          const text = quoted ? JSON.stringify(replacement) : replacement
          code = code.slice(0, start) + text + code.slice(end)
        }

        return await writeGeneratedModule(fileUrl, code)
      } finally {
        inProgress.delete(fileUrl)
      }
    })()
    cache.set(fileUrl, promise)
    return promise
  }

  try {
    const finalUrl = await process(entryUrl)
    return await import(finalUrl) as Record<string, unknown>
  } finally {
    // Only when THIS call owns its own context (no `batchContext` passed) — a shared batch's
    // temp files stay alive until every call sharing it has settled; see `ImportBatchContext`'s
    // own doc for why cleanup shifts onto the caller in that case.
    if (ownsContext) await Promise.all(tempFiles.map((path) => Deno.remove(path).catch(() => {})))
  }
}

/** Matches ANY path ending in the exact shape {@linkcode writeGeneratedModule} writes
 * (`.zanix-import-<uuid>.js`) OR {@linkcode getAugmentedConfigPath} writes
 * (`.zanix-import-deps-<uuid>.json`) — a literal regex, not built from `GENERATED_MODULE_PREFIX`
 * via string interpolation into `RegExp`, specifically to avoid that constant's own `.` silently
 * reading as "any character" instead of a literal dot. Keep this pattern in sync with
 * `GENERATED_MODULE_PREFIX` by hand if that constant's own text ever changes. */
const GENERATED_MODULE_MATCH = /\.zanix-import-[^/\\]+\.(js|json)$/

/** Directories a REAL orphan can never sit under, even inside `src/` — the same "never real
 * source" list `ignore.base` already establishes for the whole project (`node_modules`, `.git`,
 * `.dist`, `coverage`, ...), kept in sync with it by hand (that file is plain gitignore syntax,
 * not a module this one could import a shared list from), plus `@tests` itself: a real orphan can
 * only ever come from `space.app.ts` or a real page/layout `importProjectModule`'s own callers
 * process (`importSpaceApp`, `discoverPages`) — never a test file, so a project's own `src/@tests/`
 * tree (this repo's own included) has no legitimate reason to be walked at all. Every entry here is
 * genuinely reachable under `src/` on a real project, unlike at the project root: a package manager
 * occasionally vendors into a nested `node_modules`, and this repo's own test-tier convention
 * (`naming-and-structure-conventions`) puts a real, per-suite `__tmp__/` directly under
 * `src/@tests/**` — exactly the shape a temp FIXTURE root built under this repo's own
 * `src/@tests/.../__tmp__/` produces: the whole-tree version of this walk needs to skip it on the
 * way in, not just on the way past (`@tests` alone already catches it; `__tmp__` catches the same
 * shape in a CONSUMING project's own `src/@tests/` tree too). Applied only to the recursive `src/`
 * walk below — `root`'s own shallow,
 * one-level scan never recurses far enough for any of these to matter. */
const NEVER_REAL_SOURCE = [
  /[/\\](node_modules|\.git|vendor|\.?dist|out|\.vite|dist-ssr|coverage|__tmp__|@tests)[/\\]/,
]

/** Removes every direct match of {@linkcode GENERATED_MODULE_MATCH} under `dir`, recursing only
 * when `recursive` is true (skipping {@linkcode NEVER_REAL_SOURCE} only in that recursive case —
 * see that constant's own doc for why) — best-effort throughout (see
 * {@linkcode sweepStaleGeneratedModules}'s own doc for why): `dir` not existing at all, or any
 * single file's own removal failing, is silently swallowed rather than surfaced. */
async function removeGeneratedModulesUnder(dir: string, recursive: boolean): Promise<void> {
  try {
    for await (
      const entry of walk(dir, {
        maxDepth: recursive ? Infinity : 1,
        match: [GENERATED_MODULE_MATCH],
        skip: recursive ? NEVER_REAL_SOURCE : undefined,
        includeDirs: false,
      })
    ) {
      await Deno.remove(entry.path).catch(() => {})
    }
  } catch {
    // `dir` doesn't exist (no `src/` at all is a real, valid project shape) or is genuinely
    // unreadable — not this function's own concern to surface either way.
  }
}

/**
 * Removes every `.zanix-import-*.js` file sitting where one could ACTUALLY be — garbage a KILLED
 * earlier `zanix space dev`/`build` process leaves behind (Ctrl+C, a crash, a force-quit), never
 * something a healthy run produces: every temp file {@linkcode writeGeneratedModule} writes is
 * deleted in its own `finally`, in the SAME process, the instant the import that created it
 * resolves — nothing legitimate ever survives long enough for a LATER, separate invocation to
 * find. A fresh, random UUID names each one, so an orphan is never overwritten or revisited by a
 * later run either — left alone, these accumulate on disk forever, one per killed process, with no
 * self-healing mechanism otherwise.
 *
 * Called once, at the very top of `zanix space dev`/`build`, before either command does any real
 * work — see each command's own `action.ts`.
 *
 * **Scoped to exactly the two places an orphan can ever actually exist, not a whole-tree walk with
 * a skip list**: `root`'s own direct children (`space.app.ts` itself always sits directly at the
 * project root, never nested — its own orphan, if any, is a direct sibling) and everything
 * recursively under `root/src` (every OTHER file `importProjectModule` ever recurses into — a
 * page, a layout, anything reached via a RELATIVE import from one of those — lives there by
 * convention: `getRoutesDir()`'s own default, and every scaffolded project's own layout). This
 * means `node_modules`/`.git`/`.dist`/`coverage`/... are never even considered, not because of a
 * skip list this function has to keep in sync with `ignore.base` by hand, but because nothing
 * under any of them was ever a real candidate location to begin with — both cheaper (skips walking
 * `node_modules`, which can be genuinely huge, entirely) and more precise than the alternative.
 * The one real tradeoff: a project relatively importing from `space.app.ts` to somewhere OUTSIDE
 * `src/` (nothing enforces the convention) can leave an orphan this narrower scope misses —
 * accepted, same "best-effort, not exhaustive" contract the rest of this function already has.
 *
 * A THIRD place also gets a shallow sweep: `findDenoConfigPath(root)`'s own directory, when it's
 * NOT `root` itself — a real, if rarer, shape for a workspace member whose nearest config is an
 * ANCESTOR workspace root (`findDenoConfigPath`'s own doc: "preferring a workspace-bearing config
 * over the nearest plain one"). `getAugmentedConfigPath`/`prepareTransitiveCollisionReexec` both
 * write their own temp files as a sibling of THAT config path, never necessarily `root` — a killed
 * process in that shape would otherwise leave an orphan neither of the first two scopes ever
 * walks.
 *
 * Deliberately best-effort throughout: this is opportunistic cleanup, never something that should
 * fail `zanix space dev`/`build` itself over a stray file this project doesn't even need removed
 * right now (a permissions issue, a concurrent second `zanix` process sweeping the same tree).
 *
 * @param root - The project's own root directory — the same `root` `zanix space dev`/`build`
 * already resolves from `Deno.cwd()`.
 */
export async function sweepStaleGeneratedModules(root: string): Promise<void> {
  await removeGeneratedModulesUnder(root, false)
  await removeGeneratedModulesUnder(join(root, 'src'), true)

  const configPath = findDenoConfigPath(root)
  const configDir = configPath && dirname(configPath)
  if (configDir && resolvePath(configDir) !== resolvePath(root)) {
    await removeGeneratedModulesUnder(configDir, false)
  }
}
