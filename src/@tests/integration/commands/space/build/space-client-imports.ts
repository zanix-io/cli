import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'

/**
 * Every fixture in this folder writes a scaffolded project's `deno.json` by hand (never through
 * the real `zanix new space` scaffolder), always as a MINIMAL `{ zanix: { project: 'space' } }` —
 * deliberately not a real, complete `imports` map the way `saveZanixConfig`/`ensureZanixDependency`
 * would actually write for a real project.
 *
 * `@zanix/space` (root) and `@zanix/space/react`/`@zanix/space/preact` need declaring here for a
 * DIFFERENT reason than everything else in this file: `importSpaceApp` (`import-space-app.ts`)
 * resolves a project's `space.app.ts` through `importProjectModule` (`import-project-module.ts`)
 * — a real, ISOLATED `@deno/loader` `Workspace` anchored at that project's OWN `deno.json(c)`, not
 * `cli`'s own native module resolution. `cli`'s own process happening to have `@zanix/space`
 * pre-warmed (dozens of this repo's own source files import it statically) is irrelevant to that
 * separate resolver — it only ever sees what the fixture's OWN config declares. Without these
 * entries, `importSpaceApp` fails outright with "not a dependency" for every fixture in this
 * folder, even though `@zanix/space` genuinely is pre-warmed in `cli`'s own native module graph.
 *
 * Everything else this file declares needs it for the ORIGINAL, narrower reason: a nested
 * `deno.json` with no `imports` of its own genuinely shadows `cli`'s own root import map for
 * plain, native resolution too (confirmed empirically — a plain `deno run` from inside such a
 * nested project can't resolve even an already pre-warmed specifier either), but these OTHER
 * specifiers were never reached through a STATIC import anywhere in `cli`'s own source in the
 * first place, so there was never a pre-warmed cache entry for them to fall back on regardless of
 * which resolver reaches them:
 *
 * `@zanix/space/client`/`@zanix/space/client/preact` are different: nothing in `cli`'s OWN source
 * ever imports them statically (only `client-entry-plugin.ts`, inside `@zanix/space` itself,
 * generates a STRING containing that import, resolved fresh by Rolldown at build time) — so there
 * is no pre-warmed cache entry to fall back on, and a fixture's own minimal `deno.json` genuinely
 * has nothing to resolve it against. Every fixture that runs a real `zanix space build` (which
 * always builds the client-entry bundle, every renderer, unconditionally) needs this declared
 * explicitly, the same way a REAL scaffolded project's own complete `deno.json` already would.
 *
 * Every entry here is a real, published `jsr:@zanix/space@^1.3.0`/`jsr:@zanix/utils@^4.2.1`
 * subpath, derived from `ZANIX_DEPENDENCY_VERSIONS` — NOT a raw local-disk path into a sibling
 * `space`/`utils` checkout, unlike this file's own earlier shape (renamed from
 * `local-space-client-imports.ts`/`LOCAL_SPACE_CLIENT_IMPORTS`, 2026-08-30). A raw local path was
 * load-bearing until then: `@zanix/space/client`'s real, published entry (`hydrate-comets.ts`'s own
 * bare `'react-dom/client'`/`'preact'` imports) tripped a genuine `@deno/vite-plugin@2.0.3` bug the
 * moment it resolved from an HTTPS (`https://jsr.io/...`) referrer instead of a local `file://` one
 * — `@deno/loader` bakes the resolved specifier into the transpiled code with an erroneous leading
 * slash (`npm:/react-dom@^19.2.0/client`), which `@deno/vite-plugin`'s own `resolveDeno()` then
 * mis-parses into a broken bare name (`/react-dom`, slash included), which Rollup's `this.resolve()`
 * treats as a real absolute filesystem path — `[UNLOADABLE_DEPENDENCY] Could not load
 * ../../../.../react-dom`. A local `file://` referrer never hits the bug (confirmed: the same
 * import resolved that way never gets the extra slash), which is why staying on one masked it here
 * — but it never fixed anything: a REAL consumer's own `zanix space build`/`zanix space dev` always
 * resolves `@zanix/space/client` via HTTPS, never a local path, so this was a real, currently-live
 * bug for every renderer, not something these fixtures merely failed to cover.
 *
 * Now fixed at the actual call site instead: `fixNpmSlashSpecifierPlugin`
 * (`commands/space/build/lib/plugins/fix-npm-slash-specifier.ts`) is wired into both
 * `spaceBuildAction`'s `buildSpaceClient({ plugins })` and `spaceDevAction`'s
 * `createSpaceDevEngine({ plugins })` — see that module's own doc for the full mechanism. Validated
 * directly (2026-08-30, not assumed) across all four combinations this fixes: `zanix space build`
 * with `--renderer react` and `--renderer preact` (via this repo's own integration suite, pure-JSR
 * form, zero `UNLOADABLE_DEPENDENCY`), and `zanix space dev` with both renderers (via a disposable
 * spike calling `createSpaceDevEngine(...).transformClientAsset(...)` directly against a real,
 * non-locally-linked consumer project on `@zanix/space@0.3.0` — confirmed the malformed `"/react-dom"`
 * import in the served code without the fix, and the correct, browser-loadable
 * `/node_modules/.vite/deps/...` resolution with it, for both renderers). With the actual bug fixed
 * at the point every renderer/mode shares, `cli`'s own test suite no longer needs — and no longer
 * has — any dependency on a sibling `space`/`utils` checkout existing on disk (this repo's own CI
 * never checks one out), which is the whole reason this file exists rather than just inlining these
 * three entries at each call site: one shared, always-real, always-JSR source of truth.
 *
 * `@zanix/logger/client` is one further transitive hop: `@zanix/space/client/mod.ts` itself imports
 * `hydrate-comets.ts` → `client-logger.ts` → `createClientLogger` from `@zanix/logger/client` —
 * never pre-warmed either, for the exact same "nothing statically imports it" reason above.
 *
 * `@zanix/space/assets-manifest` is a THIRD, unrelated gap this same "nested `deno.json` shadows
 * the root" mechanism exposes: `space-icons-e2e.test.ts` dynamically imports it directly (never
 * pre-warmed by any static import anywhere either), so it needs the exact same treatment even
 * though it has nothing to do with the client-entry feature.
 *
 * `@zanix/errors` is a FOURTH instance of the same "nothing pre-warms this" gap, `@zanix/space`
 * 0.3.0's own addition: `modules/client/hydrate-error-boundaries.ts`/`-preact.ts` (the new
 * client-side error-boundary feature) import it bare, resolved fresh by Rolldown/Vite at build/dev
 * time same as the client-entry imports above — never pre-warmed, and a fixture's own minimal
 * `deno.json` has nothing to resolve it against either.
 *
 * @module
 */

// No bare `@zanix/utils` entry exists in `ZANIX_DEPENDENCY_VERSIONS` (only its subpaths, e.g.
// `@zanix/utils/logger` below) — the package's own version floor is recovered by stripping the
// `/logger` suffix off that entry, rather than adding a redundant bare-package entry there just
// for this file's own sake.
const UTILS_BASE = ZANIX_DEPENDENCY_VERSIONS['@zanix/utils/logger'].replace(/\/logger$/, '')

/** Spread into a fixture's own `deno.json` `imports` map — always safe to include every entry
 * unconditionally, even for a react-only fixture: an unused import-map entry costs nothing, and it
 * keeps every fixture in this folder identical regardless of which renderer it happens to test. */
export const SPACE_CLIENT_IMPORTS: Record<string, string> = {
  '@zanix/space': ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
  '@zanix/space/react': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/react`,
  '@zanix/space/preact': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/preact`,
  '@zanix/space/client': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/client`,
  '@zanix/space/client/preact': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/client/preact`,
  '@zanix/logger/client': `${UTILS_BASE}/logger/client`,
  '@zanix/space/assets-manifest': `${ZANIX_DEPENDENCY_VERSIONS['@zanix/space']}/assets-manifest`,
  '@zanix/errors': `${UTILS_BASE}/errors`,
}
