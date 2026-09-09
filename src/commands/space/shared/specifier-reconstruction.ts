import { parse as parseJsonc } from '@std/jsonc'

/**
 * Low-level specifier utilities shared by `transitive-collision.ts`, `import-project-dependency.ts`,
 * and `import-project-module.ts` — splitting a bare specifier into its package base/subpath,
 * reconstructing a real scheme-based (`jsr:`/`npm:`) specifier from a config's own declared value
 * or an already-resolved `node_modules` path, and the one shared constant naming the three
 * packages a served project's own resolution must always control (never `@zanix/cli`'s).
 *
 * @module
 */

/** A specifier already carrying its own scheme (`jsr:`, `npm:`, `https:`, `node:`, `data:`, ...)
 * is unambiguous on its own — never resolved through `Loader.resolveSync`, never rewritten. */
export const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** The one filename prefix every temp file `import-project-module.ts`'s own `writeGeneratedModule`
 * writes shares — shared with `sweepStaleGeneratedModules` and `prepareTransitiveCollisionReexec`,
 * each of which matches against (or writes under) this same prefix. Kept as one constant
 * specifically so neither can ever drift apart from the other. */
export const GENERATED_MODULE_PREFIX = '.zanix-import-'

/** Reads `configPath`'s own top-level `imports` map and returns its raw, LITERAL value for
 * `specifier` (an exact key match only — no `scopes`, no prefix/alias expansion), or `undefined`
 * when there's no such entry, the file can't be read, or it doesn't parse. Only ever consulted as
 * a fallback for the one real gap `Loader.resolveSync` has: an `npm:` bare specifier needs a real
 * dependency-constraint solve to resolve without `Loader.addEntrypoints` — deliberately never
 * called here (see `import-project-module.ts`'s own module doc for why: the file path it would
 * otherwise produce bypasses Deno's own CJS/ESM interop entirely). A project's own declared literal
 * (still carrying its `npm:`/`jsr:` scheme, still possibly an unpinned semver range) is exactly
 * what a normal `import 'is-odd'` statement in that project would have resolved through on its
 * own — handing it to native `import()` unchanged lets Deno do that same resolution, interop
 * included. */
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
export function splitPackageSpecifier(specifier: string): { base: string; subpath: string } {
  const parts = specifier.split('/')
  const base = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return { base, subpath: specifier.slice(base.length) }
}

/** Base package names `import-project-dependency.ts`'s own `importProjectDependency` resolves for
 * `@zanix/cli`'s own native orchestration calls (`dev/action.ts`, `build/action.ts`,
 * `import-space-app.ts`, `dev/validation.ts`) — `cli` no longer holds a SEPARATE, natively-loaded
 * module instance of any of these at all. `import-project-module.ts`'s own `resolveReplacement`
 * "try `cli`'s config" fallback exists only to protect shared module-level identity for a package
 * `cli` ALSO imports natively for its own orchestration (a renderer registry, a route registry,
 * ...) — with no separate `cli`-native import left to protect identity with for these three,
 * deferring to `cli`'s own answer for them has nothing left to guard, and would actively
 * REINTRODUCE a divergence whenever `cli` itself runs from a local checkout (`cliConfigPath` a
 * real, fixed path, unrelated to `Deno.cwd()` — `cli-loader.ts`'s own `getCliLoader` doc covers
 * this): `cli`'s own native orchestration now always resolves these against the SERVED PROJECT's
 * config, so the project's own `space.app.ts` import must too, unconditionally, in every install
 * shape. */
export const PROJECT_ANCHORED_ONLY_PACKAGES = new Set([
  '@zanix/space',
  '@zanix/app',
  '@zanix/server',
])

/** Reconstructs a scheme-based specifier for `specifier` from `configPath`'s own `imports` map —
 * an exact match first, then the specifier's own base PACKAGE name with its subpath appended to
 * whatever scheme literal that package resolves to (the same shape a real `jsr:`/`npm:` subpath
 * specifier already takes, e.g. `npm:react@^X.Y.Z` + `/jsx-runtime` → `npm:react@^X.Y.Z/jsx-
 * runtime`). Returns `undefined` when neither is declared, or the declared value isn't itself
 * scheme-based (a local alias has nothing useful to reconstruct from). */
export function reconstructSchemeSpecifier(
  configPath: string,
  specifier: string,
): string | undefined {
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
 * jsr:@zanix/cli` install (`cli-loader.ts`'s own `getCliLoader` doc), so
 * `reconstructSchemeSpecifier(cliConfigPath, specifier)` silently evaluates to `undefined` on
 * every real global install, falling through to the raw `file://` `node_modules` path this whole
 * mechanism exists to avoid — a bare `'react/jsx-runtime'` resolved that way still fails with the
 * same "does not provide an export" error the scheme reconstruction above is meant to prevent,
 * since it never runs without a config path.
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
