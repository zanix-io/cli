import { type Loader, MediaType, RequestedModuleType, ResolutionMode } from '@deno/loader'
import { dirname, fromFileUrl, join, resolve as resolvePath, toFileUrl } from '@std/path'
import { walk } from '@std/fs'
import { isFileUrl } from '@zanix/helpers'
import { init as esModuleLexerInit, parse as parseEsModule } from 'es-module-lexer'
import {
  findDenoConfigPath,
  findNearestPlainConfigPath,
} from 'commands/space/shared/deno-config-discovery.ts'
import {
  cliConfigPath,
  cliLoaderHasNoRealLocalAnswer,
  getCliLoader,
  getLoaderFor,
  resolvesIntoCliOwnSourceTree,
} from 'commands/space/shared/cli-loader.ts'
import { locateCliLockPath } from 'commands/space/shared/native-dependency-freshness.ts'
import {
  GENERATED_MODULE_PREFIX,
  PROJECT_ANCHORED_ONLY_PACKAGES,
  reconstructNpmSpecifierFromResolvedPath,
  reconstructSchemeSpecifier,
  SCHEME_RE,
  splitPackageSpecifier,
} from 'commands/space/shared/specifier-reconstruction.ts'
import { detectTransitiveCollisionPackages } from 'commands/space/shared/transitive-collision.ts'

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
 * 1. The PROJECT's own configuration is the primary, controlling answer for a bare specifier — it
 *    is the one source that genuinely expresses which version THIS project depends on. A result
 *    that carries its own scheme (`jsr:`, `npm:`, `https:`, `node:`) is left exactly as
 *    `@deno/loader` resolved it: native `import()` follows one of these correctly from ANY
 *    governing config, since a published package carries its own self-contained dependency graph.
 *    A result that lands in `node_modules` (a real, already-installed npm package) is
 *    reconstructed back into its own scheme form instead of being handed to `import()` as a raw
 *    file path, which bypasses Deno's own CJS/ESM interop — a bare `'react/jsx-runtime'` resolved
 *    this way reads as a plain ESM re-export with no `jsx` named export. A result that lands
 *    anywhere else on disk is only followed recursively when a real `deno.json(c)` exists
 *    somewhere above it — proof it's genuinely part of a project's own source tree (or a
 *    linked/workspace sibling with its own config), not vendored third-party code otherwise
 *    materialized outside `node_modules` (Deno's own global npm/jsr cache, for instance).
 * 2. Only a specifier the PROJECT's own configuration genuinely has no answer for at all falls back
 *    to `@zanix/cli`'s OWN configuration. This matters whenever `@zanix/cli` ITSELF natively
 *    imports a package for its own orchestration and shares real, module-level protocol state
 *    through it with whatever `space.app.ts` imports, but ALSO covers a narrower, structural need:
 *    a rewritten temp file is a LOOSE file with no import map of its own to fall back on under a
 *    real global install, so a specifier the project reaches only through a relative import chain
 *    (never itself an explicit project dependency) still needs SOME resolvable answer.
 *
 *    **EXCEPT** for `@zanix/space`/`@zanix/app`/`@zanix/server` and their subpaths
 *    ({@linkcode PROJECT_ANCHORED_ONLY_PACKAGES}) — the historical motivating case for this whole
 *    step, but `@zanix/cli` no longer holds a separate native instance of any of them at all: its
 *    own dev/build orchestration (`importProjectDependency`, used by `dev/action.ts`/
 *    `build/action.ts`/`import-space-app.ts`/`dev/validation.ts`) resolves them against the SAME
 *    project config step 1 already does, unconditionally. These three never reach this fallback at
 *    all — see step 1.
 *
 *    **ALSO EXCEPT** when `@zanix/cli`'s own answer lands INSIDE `@zanix/cli`'s own hand-written
 *    source tree (`resolvesIntoCliOwnSourceTree`) — a false positive of this exact check, never
 *    the genuine identity-sharing case above: `@zanix/cli`'s own `deno.jsonc` also declares
 *    plain internal folder aliases (`typings/`, `shared/`, `utils/` → `./src/{typings,shared,utils}/`),
 *    purely so `@zanix/cli`'s OWN source can use short bare-specifier-style imports internally —
 *    and `zanix new` scaffolds the IDENTICAL alias names into every consuming project's own
 *    `deno.json`. A project file's own `import 'utils/x.ts'` therefore ALSO "resolves successfully"
 *    against `@zanix/cli`'s config, but to `@zanix/cli`'s OWN `src/utils/x.ts`, never the
 *    project's — silently, until the two files' exports diverge (e.g. a project's own interactor
 *    importing `utils/constants.ts` resolves against `@zanix/cli`'s own same-named file instead of
 *    its own). Treated as no answer at all in this case too.
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
 * {@linkcode reconstructSchemeSpecifier} (`specifier-reconstruction.ts`)'s own fallback only ever
 * reads the top-level map. A plain top-level alias — the normal shape a project declares one in —
 * resolves correctly.
 *
 * @module
 */

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
      if (!isFileUrl(resolved) || !isRecursable(fromFileUrl(resolved))) return resolved
      return await process(resolved)
    }

    // The PROJECT's own config is the primary, controlling answer for a bare specifier — it is
    // the one source that genuinely expresses which version THIS project depends on. `cli`'s own
    // config (tried second, below, only once this attempt has no answer at all) can ALSO resolve
    // many of the same specifiers — but only because `cli` happens to declare them too, for its
    // own, unrelated internal reasons (a generator template, a dev-loop dependency, ...), never
    // because `cli`'s own declared range is authoritative for what a served project needs. Trying
    // the project's own config first is what lets a project pin a version `cli` itself doesn't
    // know about at all — a prerelease, or simply a newer/older range than whatever `cli` happens
    // to declare for the identical package name — and have that pin actually win.
    let resolved: string | undefined
    let projectResolveError: unknown
    try {
      resolved = referrerLoader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
      // A `jsr:`/`http(s):` result from `resolveSync` ALONE is an unexpanded literal (the
      // raw import-map value, not a real resolved version) — e.g.
      // `referrerLoader.resolveSync('@zanix/auth', ...)` (against a real project's own config)
      // returns the literal `jsr:@zanix/auth@^X.Y.Z`, not a resolved version. Splicing that literal
      // in directly hands the ACTUAL version-range resolution to native `import()` at RUNTIME —
      // governed by whatever config/lockfile the PROCESS itself was started with, never
      // `referrerLoader`'s own `newestDependencyDate` (`deno-config-discovery.ts`'s own
      // `readNewestDependencyDate`) — so a project's own `"minimumDependencyAge"` setting, despite
      // correctly configuring `referrerLoader` itself, has NO effect on the specifier this branch
      // actually splices in: `Could not find version of '@zanix/auth' that matches specified
      // version constraint '^X.Y.Z' ... newer than the specified minimum dependency date`, even
      // with `"minimumDependencyAge": 0` set in the project's own `deno.json`. Forcing the real
      // dependency-constraint solve HERE, through `referrerLoader` (which DOES already carry the
      // project's own correct age-gate cutoff), produces a fully-resolved absolute URL that needs
      // no further native resolution at all — closing the gap completely, not working around it.
      //
      // **Except** when `specifier`'s base package is a detected transitive-collision risk (see
      // `transitive-collision.ts`'s own `detectTransitiveCollisionPackages` doc): the force-solve
      // step is skipped, deliberately reintroducing the `"minimumDependencyAge"` gap this comment
      // just described, for this one narrow case — a package ALSO reachable as another
      // directly-imported package's own transitive dependency needs to stay an unexpanded, still-
      // open specifier so native `import()` (run under `prepareTransitiveCollisionReexec`'s
      // re-exec'd process) can unify it with that other edge itself, instead of two
      // independently-fixed URLs silently diverging into two separate module instances.
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
      // here (see `readImportMapValue`'s own doc, `specifier-reconstruction.ts`, for why).
      // Reconstructing the project's own scheme literal for `specifier`, when one is declared,
      // hands native `import()` the exact same scheme text a normal static import would have
      // resolved through, with full interop intact. `undefined` when the project's own config
      // genuinely has no answer either — the `cli`-config fallback below gets the next attempt,
      // and `projectResolveError` (captured here) still reaches the final error message if that
      // fallback has no answer either.
      projectResolveError = error
      resolved = referrerConfigPath
        ? reconstructSchemeSpecifier(referrerConfigPath, specifier)
        : undefined
    }

    if (resolved !== undefined) {
      if (!isFileUrl(resolved)) return resolved
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
        // to the same config-free reconstruction the `cli`-config fallback below needs
        // unconditionally (see `reconstructNpmSpecifierFromResolvedPath`'s own doc for why that one
        // can never rely on a config file at all under a real global install).
        const reconstructed =
          (referrerConfigPath && reconstructSchemeSpecifier(referrerConfigPath, specifier)) ??
            reconstructNpmSpecifierFromResolvedPath(resolved, specifier)
        return reconstructed ?? resolved
      }

      if (!isRecursable(resolvedPath)) return resolved
      return await process(resolved)
    }

    // `cli`'s OWN config is consulted only once the project's own config (above) has no answer at
    // all for this specifier — never as a way to override what the project itself declares. This
    // still matters for a real reason, not merely as a courtesy: `writeGeneratedModule`'s temp
    // file is a LOOSE file living in the project's own directory, not part of any package's own
    // module graph — a bare specifier only resolves for it via whatever import map governs the
    // WHOLE running `deno` process (nearest-config discovery from a local checkout, or an explicit
    // `--config` at process startup). Under `deno install -g`, that process-wide map has no answer
    // at all for a specifier the project's own config never happens to declare directly (e.g.
    // `@zanix/helpers`, reached only through a relative import chain, never itself an explicit
    // project dependency) — native `import()` of the temp file then throws `Import
    // "@zanix/helpers" not a dependency` on every real global install. Resolving it here instead,
    // against `cli`'s OWN config, and splicing the resulting fully-qualified URL into the temp
    // file sidesteps the need for any import map at all for that one specifier.
    //
    // `@zanix/space`/`@zanix/app`/`@zanix/server` never reach this fallback
    // (`PROJECT_ANCHORED_ONLY_PACKAGES`, `specifier-reconstruction.ts`) — `cli` ITSELF imports them
    // natively for its own dev-loop orchestration and shares real, module-level protocol state
    // through them with whatever `space.app.ts` imports (a renderer registry, a route registry,
    // ...), already kept in sync with the project's own resolution by
    // `import-project-dependency.ts`'s own `importProjectDependency`, a separate convergence;
    // resolving one of them here instead, against `cli`'s own config, risks a genuinely different
    // target from that convergence, reintroducing the exact "two separate SpaceDevSocket
    // instances" failure it exists to prevent. Every other package carries no such shared-state
    // relationship with `cli` at all, so falling back to whatever `cli` happens to also declare —
    // for its own, unrelated reasons — is safe once the project's own config has already had the
    // first and controlling say.
    const packageBase = splitPackageSpecifier(specifier).base
    if (!PROJECT_ANCHORED_ONLY_PACKAGES.has(packageBase)) {
      const cliLoader = await getCliLoader()
      try {
        let cliResolved = cliLoader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
        // A `jsr:`/`http(s):` result from `resolveSync` ALONE is an UNEXPANDED literal (e.g. still
        // `jsr:@zanix/space@^X.Y.Z`, the raw import-map value, not a real resolved version) — splicing
        // that literal into the temp file below would let native `import()` perform its OWN,
        // SEPARATE version-range resolution at runtime, which can land on a version this fresh
        // lookup itself didn't produce. `@zanix/space`'s own `resolveDenoAt`
        // (`deno-optimize-deps-alias.ts`) solves the identical problem the identical way:
        // `addEntrypoints` forces the real dependency-constraint solve, then a second `resolveSync`
        // on the now-graphed literal returns the real, canonical resolved URL — which, sharing the
        // exact same `cliLoader`/lockfile state `cli`'s own internal imports resolve through,
        // converges on the identical module-cache key. `resolveSync('@zanix/space', ...)` alone
        // returns the literal `jsr:@zanix/space@^X.Y.Z`; only after `addEntrypoints` does it return
        // a real version, e.g. `https://jsr.io/@zanix/space/X.Y.Z/mod.ts`. A `file://` result needs
        // none of this — it's already a real, concrete path.
        if (
          cliResolved.startsWith('jsr:') || cliResolved.startsWith('http:') ||
          cliResolved.startsWith('https:')
        ) {
          await cliLoader.addEntrypoints([cliResolved])
          cliResolved = cliLoader.resolveSync(cliResolved, referrerUrl, ResolutionMode.Import)
        }
        // EXCEPT when that resolution lands inside `cli`'s OWN hand-written source tree
        // (`resolvesIntoCliOwnSourceTree`, `cli-loader.ts`) — a false positive, never a genuine
        // answer: `cli`'s own internal folder aliases (`typings/`, `shared/`, `utils/` →
        // `./src/{typings,shared,utils}/`, declared purely for `cli`'s OWN source to use short
        // bare-specifier imports internally) share their EXACT names with the aliases `zanix new`
        // scaffolds into every consuming project — so a project file's own
        // `import 'utils/constants.ts'` resolves "successfully" here too, but against `cli`'s OWN
        // `src/utils/constants.ts`, never the project's (the project's own `utils/constants.ts`
        // already had its chance above, and resolves correctly there whenever the project genuinely
        // declares that alias). Treated as no answer at all instead — the final `throw` below
        // reports both attempts' own failure.
        //
        // A SECOND, deeper case of the identical false-positive shape — see
        // `cliLoaderHasNoRealLocalAnswer`'s own doc (`cli-loader.ts`) for the full account —
        // surfaces as `Import "clients/registry-hub.client.ts" not a dependency`, thrown from the
        // ORIGINAL `triggers.interactor.ts`: reached this way after `page.tsx`'s own
        // `import ... from 'triggers/triggers.interactor.ts'` resolves through this exact branch and
        // returns unrecursed.
        if (
          !cliLoaderHasNoRealLocalAnswer(cliConfigPath, cliResolved) &&
          !resolvesIntoCliOwnSourceTree(cliResolved)
        ) {
          // The resolved, fully-qualified URL — never the original bare `specifier` — is what gets
          // spliced into the rewritten temp file below, for the same "no import map for a loose temp
          // file" reason documented above this whole fallback.
          //
          // EXCEPT a raw `file://` path straight into `node_modules` — the same CJS/ESM-interop gap
          // the project-anchored `node_modules` branch above already guards against (see its own
          // doc): react's own CJS entry is a runtime
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
          if (isFileUrl(cliResolved) && cliResolved.includes('/node_modules/')) {
            const reconstructed =
              (cliConfigPath && reconstructSchemeSpecifier(cliConfigPath, specifier)) ??
                reconstructNpmSpecifierFromResolvedPath(cliResolved, specifier)
            return reconstructed ?? cliResolved
          }
          return cliResolved
        }
      } catch {
        // Reconstructs the scheme-based specifier form when `reconstructSchemeSpecifier` can produce
        // one, rather than giving up outright — the same "no import map for a loose temp file"
        // concern documented above this whole fallback, just in this error path instead of the main
        // one. Returns the reconstructed scheme literal itself — the same canonical text a normal
        // static import would have resolved through, resolvable with no import map at all.
        const reconstructed = cliConfigPath
          ? reconstructSchemeSpecifier(cliConfigPath, specifier)
          : undefined
        if (reconstructed !== undefined) return reconstructed
        // `@zanix/cli`'s own config has nothing for this specifier either — falls through to the
        // final, combined failure below.
      }
    }

    throw new Error(
      `Could not resolve '${specifier}' imported from '${fromFileUrl(referrerUrl)}' against '${
        referrerConfigPath ?? '(no project deno.json found)'
      }'${
        projectResolveError ? `: ${(projectResolveError as Error).message}` : ''
      } (and @zanix/cli's own configuration has no answer for it either).`,
    )
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
 * (`.zanix-import-<uuid>.js`) OR `transitive-collision.ts`'s own `prepareTransitiveCollisionReexec`
 * writes (`.zanix-import-deps-<uuid>.json`) — a literal regex, not built from
 * `GENERATED_MODULE_PREFIX` via string interpolation into `RegExp`, specifically to avoid that
 * constant's own `.` silently reading as "any character" instead of a literal dot. Keep this
 * pattern in sync with `GENERATED_MODULE_PREFIX` (`specifier-reconstruction.ts`) by hand if that
 * constant's own text ever changes. */
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
 * A THIRD, FOURTH (and, for a workspace member, a fifth) place also gets a shallow sweep: whichever
 * of `findDenoConfigPath(root)`/`findNearestPlainConfigPath(root)`/`locateCliLockPath()`'s own
 * directory isn't `root` itself. The first two cover a real, if rarer, shape for a workspace member
 * whose nearest PLAIN config differs from its nearest WORKSPACE-preferring one (`findDenoConfigPath`'s
 * own doc: "preferring a workspace-bearing config over the nearest plain one"; `findNearestPlainConfigPath`'s
 * own doc for why detection needs the plain one specifically) — `transitive-collision.ts`'s own
 * `prepareTransitiveCollisionReexec` writes its own temp files as a sibling of the LATTER. The
 * THIRD covers `native-dependency-freshness.ts`'s own `@zanix/cli`-directory temp lock — a
 * genuinely different directory from either of the first two in every install shape (`@zanix/cli`'s
 * own checkout/shim, never a served project's config at all). A killed process in any of these
 * shapes would otherwise leave an orphan none of the first two scopes ever walks.
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

  const rootResolved = resolvePath(root)
  const cliLockPath = await locateCliLockPath()
  const configDirs = new Set(
    [findDenoConfigPath(root), findNearestPlainConfigPath(root), cliLockPath]
      .filter((path): path is string => path !== undefined)
      .map((path) => resolvePath(dirname(path)))
      .filter((dir) => dir !== rootResolved),
  )
  for (const dir of configDirs) {
    // deno-lint-ignore no-await-in-loop -- at most two entries, never worth a Promise.all for it
    await removeGeneratedModulesUnder(dir, false)
  }
}
