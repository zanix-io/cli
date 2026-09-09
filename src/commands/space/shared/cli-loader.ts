import { type Loader, Workspace } from '@deno/loader'
import { dirname, fromFileUrl } from '@std/path'
import {
  findDenoConfigPath,
  readNewestDependencyDate,
} from 'commands/space/shared/deno-config-discovery.ts'

/**
 * `@zanix/cli`'s OWN loader — a real `@deno/loader` `Workspace` built from `@zanix/cli`'s OWN
 * nearest config, used wherever a served project's own resolution needs a fallback answer against
 * `cli`'s own configuration (`specifier-reconstruction.ts`'s/`import-project-module.ts`'s own
 * "cli's config as a fallback" mechanism), or where `cli`'s own answer needs to be told apart from
 * a false positive (`cli`'s own internal source tree, or a genuine global install's own
 * "no local answer" case).
 *
 * @module
 */

/** One `Loader` per discovered config path — never a single process-wide singleton, and never one
 * per file or call. `@deno/loader` never caches a module INSTANCE itself (it only ever computes
 * resolution/content on demand), so sharing an instance across every file governed by the same
 * config introduces no second source of module identity. */
const loadersByConfigPath = new Map<string, Promise<Loader>>()

export function getLoaderFor(configPath: string | undefined): Promise<Loader> {
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
 * reused as the comparison point `import-project-module.ts`'s own `resolveReplacement` checks a
 * recursion candidate against (see that function's own doc for why).
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
 * ends up identical to the project's own resolution, `resolvesIntoCliOwnSourceTree` correctly
 * stays `false`, and this always defers to native resolution unchanged — exactly the outcome the
 * alias-collision check exists to produce when there is no real collision left to guard against. */
let cliConfigPathComputed = false
export let cliConfigPath: string | undefined

/** `@zanix/cli`'s OWN nearest config path, if any — the same lazily-computed, once-per-process
 * value {@linkcode getCliLoader} builds its `Loader` from (see that function's own doc for why
 * it's `undefined` under a real global install). Exported so `transitive-collision.ts`'s own
 * `prepareTransitiveCollisionReexec` can merge cli's OWN `"imports"` (its internal `typings/`/
 * `shared/`/`utils/`/`cli` aliases) into a re-exec'd process's config without ever duplicating
 * this computation. */
export function getCliConfigPath(): string | undefined {
  if (!cliConfigPathComputed) {
    cliConfigPath = import.meta.url.startsWith('file://')
      ? findDenoConfigPath(dirname(fromFileUrl(import.meta.url)))
      : undefined
    cliConfigPathComputed = true
  }
  return cliConfigPath
}

export function getCliLoader(): Promise<Loader> {
  return getLoaderFor(getCliConfigPath())
}

/** `true` when `resolvedUrl` — something `@zanix/cli`'s OWN loader resolved a bare specifier TO —
 * lands inside `@zanix/cli`'s OWN hand-written source tree (`dirname(cliConfigPath)`, excluding
 * `node_modules` under it) rather than a real external dependency (a JSR/npm package, wherever
 * Deno actually materializes one — its own global cache, or a local `node_modules` — never inside
 * `cli`'s own checked-out/published source itself).
 *
 * `import-project-module.ts`'s own `resolveReplacement` uses this to catch a false positive in its
 * own "`cli`'s config can also resolve this" fallback (see that function's own doc): `cli`'s
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
export function resolvesIntoCliOwnSourceTree(resolvedUrl: string): boolean {
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
