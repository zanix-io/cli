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
 *    untouched. Some packages (`@zanix/space`, `@zanix/app`, `@zanix/server`) are not only a
 *    project's own dependency: `@zanix/cli` ITSELF imports them natively for its own orchestration
 *    (`getActiveRenderer()`, `activateApps()`, `bootstrapServers()`, ...) and shares real,
 *    module-level protocol state through them with whatever `space.app.ts` imports (a renderer
 *    registry, a route registry, ...). Resolving such a specifier against the PROJECT's own config
 *    instead — even to a valid, different target — loads a SEPARATE module instance of that
 *    package, silently breaking that shared state (confirmed as a real failure: two independently
 *    loaded `SpaceDevSocket` instances each registered the same dev-socket route into
 *    `@zanix/server`'s one shared registry, and the second threw "already defined"). Deferring to
 *    native resolution whenever `@zanix/cli` already has an answer sidesteps this entirely.
 *
 *    **EXCEPT** when `@zanix/cli`'s own answer lands INSIDE `@zanix/cli`'s own hand-written source
 *    tree ({@linkcode resolvesIntoCliOwnSourceTree}) — a real, confirmed false positive of this
 *    exact check, never the genuine identity-sharing case above: `@zanix/cli`'s own `deno.jsonc`
 *    also declares plain internal folder aliases (`typings/`, `shared/`, `utils/` →
 *    `./src/{typings,shared,utils}/`), purely so `@zanix/cli`'s OWN source can use short
 *    bare-specifier-style imports internally — and `zanix new` scaffolds the IDENTICAL alias names
 *    into every consuming project's own `deno.json`. A project file's own `import 'utils/x.ts'`
 *    therefore ALSO "resolves successfully" against `@zanix/cli`'s config, but to `@zanix/cli`'s
 *    OWN `src/utils/x.ts`, never the project's — silently, until the two files' exports diverge
 *    (confirmed as a real failure: a real project's own interactor importing `utils/constants.ts`
 *    resolved against `@zanix/cli`'s own same-named file instead of its own). Falls through to step
 *    2 below in this case, exactly as if `@zanix/cli`'s config had no answer at all.
 * 2. Only a specifier `@zanix/cli` genuinely has no answer for at all — the real bug this module
 *    exists to fix — is resolved against the PROJECT's own configuration instead. A result that
 *    carries its own scheme (`jsr:`, `npm:`, `https:`, `node:`) is left exactly as `@deno/loader`
 *    resolved it: native `import()` follows one of these correctly from ANY governing config,
 *    since a published package carries its own self-contained dependency graph. A result that
 *    lands in `node_modules` (a real, already-installed npm package) is reconstructed back into
 *    its own scheme form instead of being handed to `import()` as a raw file path, which bypasses
 *    Deno's own CJS/ESM interop (confirmed as a real failure: a bare `'react/jsx-runtime'`
 *    resolved this way reads as a plain ESM re-export with no `jsx` named export). A result that
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
 * resolution to work against at all (confirmed as a real failure, `TypeError: Invalid URL`,
 * against real `@zanix/space` source before this fix).
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
 * cutoff {@linkcode Workspace} accepts. Real, confirmed gap this closes: `@deno/loader`'s own
 * config-file discovery (`configPath`) reads a project's `imports`/`compilerOptions`/etc.
 * automatically, but never translates this ONE field on its own — confirmed empirically, not
 * assumed: a real project's own `"minimumDependencyAge": 0` had zero effect on a `Workspace`
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
      // binding's actual (de)serializer rejects a real `Date` instance outright at runtime —
      // `Failed deserializing workspace options.: Error: invalid type: JsValue(Date), expected an
      // RFC 3339 formatted date and time string`, confirmed live — it only accepts the ISO string
      // form. The cast below is bridging a genuine type/runtime mismatch in `@deno/loader@0.5.0`
      // itself, not a mistake in `readNewestDependencyDate`'s own `Date`-returning signature (kept
      // as `Date` since that's the semantically correct return type for every OTHER caller).
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
 * included — confirmed live against a real global install, not hypothetical. Leaving it
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

function getCliLoader(): Promise<Loader> {
  if (!cliConfigPathComputed) {
    cliConfigPath = import.meta.url.startsWith('file://')
      ? findDenoConfigPath(dirname(fromFileUrl(import.meta.url)))
      : undefined
    cliConfigPathComputed = true
  }
  return getLoaderFor(cliConfigPath)
}

/** `true` when `resolvedUrl` — something `@zanix/cli`'s OWN loader resolved a bare specifier TO —
 * lands inside `@zanix/cli`'s OWN hand-written source tree (`dirname(cliConfigPath)`, excluding
 * `node_modules` under it) rather than a real external dependency (a JSR/npm package, wherever
 * Deno actually materializes one — its own global cache, or a local `node_modules` — never inside
 * `cli`'s own checked-out/published source itself).
 *
 * {@linkcode resolveReplacement} uses this to catch a real, confirmed false positive in its own
 * "`cli`'s config can also resolve this, leave it untouched" check (see that function's own doc):
 * `cli`'s `deno.jsonc` declares its own internal folder aliases (`typings/`, `shared/`, `utils/` →
 * `./src/{typings,shared,utils}/`, purely so `cli`'s OWN source can use short bare-specifier-style
 * imports internally) — and `zanix new` scaffolds the IDENTICAL alias names into every consuming
 * project's own `deno.json`. A project file importing `utils/constants.ts` therefore ALSO resolves
 * successfully against `cli`'s own config — but to `cli`'s OWN `src/utils/constants.ts`, never the
 * project's — the exact opposite of a genuine identity-sharing concern (`@zanix/space`,
 * `@zanix/server`, ...), which always resolves outside `cli`'s own source tree entirely. Confirmed
 * as a real, live failure, not a theoretical one: a real consuming project's own
 * `auth.interactor.ts` (`import { LOGIN_ACTIONS, TOKEN_EXPIRATION } from 'utils/constants.ts'`)
 * silently resolved against `cli`'s own `src/utils/constants.ts` instead of its own — invisible
 * only as long as BOTH files happened to export the same names; surfaced loudly, with a stack
 * trace pointing at `cli`'s own file path, the moment they diverged. */
function resolvesIntoCliOwnSourceTree(resolvedUrl: string): boolean {
  if (!cliConfigPath || !resolvedUrl.startsWith('file://')) return false
  const cliRoot = dirname(cliConfigPath)
  const resolvedPath = fromFileUrl(resolvedUrl)
  return (resolvedPath === cliRoot || resolvedPath.startsWith(`${cliRoot}/`)) &&
    !resolvedPath.includes('/node_modules/')
}

/** A second, deeper case of the identical false-positive shape {@linkcode resolvesIntoCliOwnSourceTree}
 * exists to catch — see the real, confirmed failure this closes at that function's own call site.
 * When `cliConfigPath` is `undefined` (any genuine global install), `cliLoader` is built via
 * `@deno/loader`'s own config-file auto-discovery, starting from `Deno.cwd()` — the served
 * PROJECT's own directory during a real `zanix space dev`/`build` run — so it silently becomes
 * identical to `referrerLoader`, discovering the project's own config instead of anything
 * belonging to `cli`. A `file://` result under that exact condition can never be a genuine
 * `cli`-own-identity answer at all: `cli` has no local source tree of its own to have a real
 * answer for in the first place there, and a genuine package identity (`@zanix/space` et al.)
 * always resolves to a `jsr:`/`https:` target under a global install, never `file://` (save for a
 * deliberate local `links` override, which needs the same recursive treatment a project's own
 * file gets regardless) — so it must be `cliLoader`'s auto-discovery accidentally matching a
 * project's own bare LOCAL alias (e.g. `"triggers/": "./src/triggers/"`) instead. Extracted as its
 * own pure, testable function specifically because this exact branch can never be exercised by a
 * real `deno test` run (`cliConfigPath` is only ever `undefined` when this module itself loaded
 * from a remote `jsr:`/`https:` specifier, never a local `file://` checkout — the same limitation
 * `getCliLoader`'s own test documents) — testing the pure boolean logic directly is the next best
 * thing to a real end-to-end repro. */
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
 * `import()` using their own resolved path unchanged: native `import()` cannot load either at all
 * on its own, confirmed as a real failure once `discoverPages` started recursing this deep. */
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

/** Reconstructs a scheme-based specifier for `specifier` from `configPath`'s own `imports` map —
 * an exact match first, then the specifier's own base PACKAGE name with its subpath appended to
 * whatever scheme literal that package resolves to (the same shape a real `jsr:`/`npm:` subpath
 * specifier already takes, e.g. `npm:react@^19.2.0` + `/jsr-runtime` → `npm:react@^19.2.0/jsx-
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
 * `@radix-ui+primitive`, confirmed against a real `node_modules/.deno/` listing) and its resolved
 * version. */
const NPM_CACHE_PATH_RE = /\/node_modules\/\.deno\/((?:@[^/+]+\+)?[^/@]+)@([^/]+)\/node_modules\//

/** A last-resort fallback for {@linkcode reconstructSchemeSpecifier} when there's no local config
 * FILE to read at all — real, confirmed gap this closes: `cliConfigPath` is `undefined` for any
 * genuine `deno install -g jsr:@zanix/cli` install (`getCliLoader`'s own doc), so
 * `reconstructSchemeSpecifier(cliConfigPath, specifier)` silently evaluates to `undefined` on
 * every real global install, falling through to the raw `file://` `node_modules` path this whole
 * mechanism exists to avoid — reported live (`zanix-iam`, real 2.0.8 global install): `Import
 * {jsx} from 'react/jsx-runtime'` still failed with the exact same "does not provide an export"
 * error, unchanged by that fix, because the reconstruction never actually ran.
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
    // packages (`@zanix/space`, `@zanix/app`, `@zanix/server`) are not only a project's own
    // dependency — `@zanix/cli` ITSELF imports them natively for its own orchestration
    // (`getActiveRenderer()`, `activateApps()`, `bootstrapServers()`, ...) and shares real,
    // module-level protocol state through them with whatever `space.app.ts` imports (a renderer
    // registry, a route registry, ...). Resolving the specifier against the PROJECT's own config
    // instead — even to a genuinely valid, different target — loads a SEPARATE module instance of
    // that package, silently breaking that shared state. Confirmed as a real, not theoretical,
    // failure: two separately-loaded `SpaceDevSocket` instances (one reached through `@zanix/cli`'s
    // own native `@zanix/space` import, one through this function's own project-anchored
    // resolution) each registered the same dev-socket route into `@zanix/server`'s one shared route
    // registry, and the second registration threw "already defined". Only a specifier `@zanix/cli`
    // genuinely has no answer for at all — the real bug this whole module exists to fix — falls
    // through to the project's own resolution below.
    const cliLoader = await getCliLoader()
    try {
      let cliResolved = cliLoader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
      // A `jsr:`/`http(s):` result from `resolveSync` ALONE is an UNEXPANDED literal (e.g. still
      // `jsr:@zanix/space@^1.3.0`, the raw import-map value, not a real resolved version) — real,
      // confirmed regression this closes: splicing that literal into the temp file below let
      // native `import()` perform its OWN, SEPARATE version-range resolution at runtime, which can
      // land on a DIFFERENT actual version than whatever `cli`'s own static `@zanix/space` import
      // resolved to — reintroducing the exact "two separate SpaceDevSocket instances" bug this
      // whole deferral exists to prevent, just one level deeper than the false-positive case
      // {@linkcode resolvesIntoCliOwnSourceTree} already guards against. `@zanix/space`'s own
      // `resolveDenoAt` (`deno-optimize-deps-alias.ts`) documents solving the identical problem the
      // identical way: `addEntrypoints` forces the real dependency-constraint solve, then a second
      // `resolveSync` on the now-graphed literal returns the real, canonical resolved URL — which,
      // sharing the exact same `cliLoader`/lockfile state `cli`'s own internal imports resolve
      // through, converges on the identical module-cache key. Confirmed via a real, isolated repro:
      // `resolveSync('@zanix/space', ...)` alone returns the literal `jsr:@zanix/space@^1.3.0`;
      // only after `addEntrypoints` does it return a real version, e.g.
      // `https://jsr.io/@zanix/space/1.3.0/mod.ts`. A `file://` result needs none of this — it's
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
      // ({@linkcode resolvesIntoCliOwnSourceTree}) — a real, confirmed false positive of the
      // check above, never the genuine identity-sharing case it exists for: `cli`'s own internal
      // folder aliases (`typings/`, `shared/`, `utils/` → `./src/{typings,shared,utils}/`,
      // declared purely for `cli`'s OWN source to use short bare-specifier imports internally)
      // share their EXACT names with the aliases `zanix new` scaffolds into every consuming
      // project — so a project file's own `import 'utils/constants.ts'` resolves "successfully"
      // here too, but against `cli`'s OWN `src/utils/constants.ts`, never the project's. Falls
      // through to the project's own resolution below instead, exactly as if `cli`'s config had
      // no answer at all — see that function's own doc for the real, confirmed failure this
      // closes.
      //
      // A SECOND, deeper case of the identical false-positive shape — see
      // {@linkcode cliLoaderHasNoRealLocalAnswer}'s own doc for the full account: real, confirmed
      // failure this closes (reported live, `zanix-iam`/`aeratech-console`, `zanix space build`),
      // `Import "clients/registry-hub.client.ts" not a dependency`, thrown from the ORIGINAL
      // `triggers.interactor.ts` — reached this way after `page.tsx`'s own
      // `import ... from 'triggers/triggers.interactor.ts'` resolved through this exact branch and
      // returned unrecursed.
      if (
        !cliLoaderHasNoRealLocalAnswer(cliConfigPath, cliResolved) &&
        !resolvesIntoCliOwnSourceTree(cliResolved)
      ) {
        // The resolved, fully-qualified URL — never the original bare `specifier` — is what gets
        // spliced into the rewritten temp file below. Real, confirmed bug: `writeGeneratedModule`'s
        // temp file is a LOOSE file living in the PROJECT's own directory, not part of any
        // package's own module graph — a bare specifier only resolves for it via whatever import
        // map governs the WHOLE running `deno` process (nearest-config discovery from a local
        // checkout, or an explicit `--config` at process startup), never `cli`'s own config
        // specifically. Under `deno install -g` (no matching entry in whatever config the shim
        // forces process-wide), that process-wide map has no answer for `@zanix/space`/
        // `@zanix/app`/`@zanix/server` at all — native `import()` of the temp file then throws
        // `Import "@zanix/space" not a dependency` on every real global install, even though
        // `cliLoader` above already resolved it successfully one line up. Splicing in `cliResolved`
        // sidesteps the need for any import map at all — a fully-qualified specifier resolves
        // identically regardless of which config governs the process — while still preserving the
        // shared module instance the surrounding comment's `SpaceDevSocket` case depends on: Deno's
        // module cache keys by resolved URL, not by which import statement reached it, and
        // `@deno/loader`'s own `resolveSync` mirrors Deno's native resolution algorithm by design,
        // so the two converge on the identical cache key.
        //
        // EXCEPT a raw `file://` path straight into `node_modules` — the same CJS/ESM-interop gap
        // the project-anchored `node_modules` branch further down already guards against (see its
        // own doc), missed here originally since this branch didn't exist yet when that one was
        // written. Real, confirmed failure (reported live against `react/jsx-runtime`, reached via
        // `discoverPages`'s static-analysis pass): react's own CJS entry is a runtime
        // `if (process.env.NODE_ENV === 'production') { ... } else { ... }` conditional `require`,
        // which Deno's static CJS→ESM named-export analysis can't see through — a raw `file://`
        // import of it exposes NO named exports at all, so `import { jsx } from
        // 'react/jsx-runtime'` fails outright even though the file resolved successfully.
        // Reconstructing the scheme-based specifier form instead (`npm:react@^19.2.0/jsx-runtime`)
        // hands native `import()` the same text a normal static import would have used, with full
        // npm CJS/ESM interop intact — using `cliConfigPath` here, never `referrerConfigPath`: the
        // import-map entry being reconstructed is `cli`'s own, not the project's.
        //
        // Real, confirmed regression in this exact reconstruction, found AFTER first shipping it:
        // `cliConfigPath` is `undefined` for any genuine global install (never a local checkout —
        // see `getCliLoader`'s own doc), which made `reconstructSchemeSpecifier` silently no-op on
        // every real-world case that needed it — reported live (`zanix-iam`) with the identical
        // "does not provide an export named 'jsx'" failure, unchanged by the first fix, because
        // reconstruction never actually ran. `reconstructNpmSpecifierFromResolvedPath` is the real
        // fallback for exactly that case: it needs no config file at all, parsing the version
        // straight out of `cliResolved` itself via Deno's own npm-cache directory convention.
        if (cliResolved.startsWith('file://') && cliResolved.includes('/node_modules/')) {
          const reconstructed =
            (cliConfigPath && reconstructSchemeSpecifier(cliConfigPath, specifier)) ??
              reconstructNpmSpecifierFromResolvedPath(cliResolved, specifier)
          return reconstructed ?? cliResolved
        }
        return cliResolved
      }
    } catch {
      // Real, confirmed bug this closes: this branch computed `reconstructSchemeSpecifier`'s
      // result only to check it wasn't `undefined`, then discarded it and returned the ORIGINAL
      // bare `specifier` instead — reintroducing the exact "no import map for a loose temp file"
      // failure 2.0.4's own fix (the `!resolvesIntoCliOwnSourceTree` branch above) exists to
      // prevent, just in this error-fallback path instead of the main one. Now returns the
      // reconstructed scheme literal itself — the same real, canonical text a normal static
      // import would have resolved through, resolvable with no import map at all, exactly like
      // the identical pattern the project-anchored fallback below already uses correctly.
      const reconstructed = cliConfigPath
        ? reconstructSchemeSpecifier(cliConfigPath, specifier)
        : undefined
      if (reconstructed !== undefined) return reconstructed
      // `@zanix/cli`'s own config has nothing for this specifier at all — falls through.
    }

    let resolved: string
    try {
      resolved = referrerLoader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
      // Same real, confirmed gap as `cliLoader`'s own identical fix above, applied here for a
      // DIFFERENT reason: a `jsr:`/`http(s):` result from `resolveSync` ALONE is an unexpanded
      // literal (the raw import-map value, not a real resolved version) — confirmed via a real,
      // isolated repro: `referrerLoader.resolveSync('@zanix/auth', ...)` (against a real project's
      // own config) returns the literal `jsr:@zanix/auth@^1.1.2`, not a resolved version. Splicing
      // that literal in directly hands the ACTUAL version-range resolution to native `import()` at
      // RUNTIME — governed by whatever config/lockfile the PROCESS itself was started with, never
      // `referrerLoader`'s own `newestDependencyDate` ({@linkcode readNewestDependencyDate}) — so a
      // project's own `"minimumDependencyAge"` setting, despite correctly configuring
      // `referrerLoader` itself, had NO effect on the specifier this branch actually spliced in:
      // real, confirmed failure, `Could not find version of '@zanix/auth' that matches specified
      // version constraint '^1.1.2' ... newer than the specified minimum dependency date`, even
      // with `"minimumDependencyAge": 0` set in the project's own `deno.json`. Forcing the real
      // dependency-constraint solve HERE, through `referrerLoader` (which DOES already carry the
      // project's own correct age-gate cutoff), produces a fully-resolved absolute URL that needs
      // no further native resolution at all — closing the gap completely, not working around it.
      if (
        resolved.startsWith('jsr:') || resolved.startsWith('http:') || resolved.startsWith('https:')
      ) {
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
      // the same as the constraint-solve-failure case above (confirmed as a real failure: a bare
      // `'react/jsx-runtime'` resolved this way reads as a plain ESM re-export with no `jsx` named
      // export, when the real npm-specifier form resolves and interops correctly) — reconstructed
      // the same way, for the same reason. `referrerConfigPath` is `undefined` only in the
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
   * at all (confirmed as a real failure, `TypeError: Invalid URL`, against real `@zanix/space`
   * source before this fix). Shared between the main JS-rewrite path below and the non-JS stub path
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
          // because native `import()` cannot load either one on its own at all, confirmed as a
          // real failure: a Comet's own `*.module.css` import, reachable through a page this
          // function now recurses into for `discoverPages`'s own build-time discovery pass (see
          // `discoverPages`'s own `importModule` option, `@zanix/space`), throws Deno's own
          // "Expected a JavaScript or TypeScript module, but identified a Css module" the instant
          // the rewritten temp file's own `import` statement runs — never hit before, since nothing
          // reaching this deep in the graph needed a real CSS import until `discoverPages` started
          // using this function too. A stub is safe here specifically because nothing at THIS
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
          // Every OTHER non-JS media type (HTML, Markdown, SQL, Wasm, ...) has no confirmed real
          // usage reaching this function yet — left exactly as before this fix, handed to
          // `import()` using its own resolved path unchanged, rather than guessing at a stub shape
          // with no real failure to confirm it against.
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
 * (`.zanix-import-<uuid>.js`) — a literal regex, not built from `GENERATED_MODULE_PREFIX` via
 * string interpolation into `RegExp`, specifically to avoid that constant's own `.` silently
 * reading as "any character" instead of a literal dot. Keep this pattern in sync with
 * `GENERATED_MODULE_PREFIX` by hand if that constant's own text ever changes. */
const GENERATED_MODULE_MATCH = /\.zanix-import-[^/\\]+\.js$/

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
 * `src/@tests/**` — exactly the shape that broke this sweep's own tests before this list existed (a
 * temp FIXTURE root built under this repo's own `src/@tests/.../__tmp__/`, which the whole-tree
 * version of this walk used to skip on the way in, not just on the way past — `@tests` alone
 * already would have caught it, `__tmp__` catches the same shape in a CONSUMING project's own
 * `src/@tests/` tree too). Applied only to the recursive `src/` walk below — `root`'s own shallow,
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
 * Removes every `.zanix-import-*.js` file sitting where one could ACTUALLY be — real, confirmed
 * garbage a KILLED earlier `zanix space dev`/`build` process left behind (Ctrl+C, a crash, a
 * force-quit), never something a healthy run produces: every temp file {@linkcode writeGeneratedModule}
 * writes is deleted in its own `finally`, in the SAME process, the instant the import that created
 * it resolves — nothing legitimate ever survives long enough for a LATER, separate invocation to
 * find. A fresh, random UUID names each one, so an orphan is never overwritten or revisited by a
 * later run either — left alone, these accumulate on disk forever, one per killed process, with no
 * self-healing mechanism. Confirmed as a real, live problem, not a hypothetical one: four genuine
 * orphans, from earlier killed sessions, found sitting in a real consumer project's own `src/`
 * tree (`src/space/routes/`, `src/auth/`) before this function existed.
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
}
