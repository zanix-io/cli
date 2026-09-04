import { assertEquals } from '@std/assert'

// ================================================================================================
// Regression guard for `deno.jsonc`'s own native-runtime-module declarations (`@zanix/auth`'s and
// `@zanix/datamaster`'s/`@zanix/notifications`'s entries, `imports` block).
//
// `RealImportEvaluator.runExternalModule` (`ssr-module-evaluator.ts`, `@zanix/space`) does a plain
// native `import(specifier)` for any bare specifier `@zanix/space`'s own `nativeRuntimeModulesPlugin`
// (`native-runtime-modules.ts`) lists in `NATIVE_RUNTIME_MODULES` — deliberately routed this way so
// the SSR-evaluated copy shares real reference identity with whatever the native `zanix space dev`
// process already loaded (see that file's own doc for the module-identity bug this closes). That
// `import()` runs inside the SAME process `zanix space dev` itself started, so it resolves against
// `cli`'s OWN governing `deno.jsonc` — never a scaffolded project's own `deno.json` (see
// `import-project-module.ts`'s own module doc for why a whole `deno run <entry>` invocation shares
// one governing resolver, rooted at the entry's own config).
//
// Every `@zanix/*` package on that list therefore needs a matching entry in `cli`'s own `deno.jsonc`
// `imports` — not because `cli` itself ever imports one of these directly (most of them, it doesn't),
// but purely so this one native `import()` has something to resolve against. `@zanix/notifications`
// and `@zanix/datamaster` were missing this entry entirely until this fix: a route/guard file reached
// through `zanix space dev`'s SSR pipeline that bare-imports either package failed outright with
// "not a dependency and not in import map", a real, reported crash against real
// `@zanix/space@1.1.0`/`1.2.0`. This test exists so the SAME gap can never silently reopen — for
// EITHER of these two, or a future package `@zanix/space` adds to its own list.
//
// `NATIVE_RUNTIME_MODULES` itself is `@zanix/space`'s own internal array — the list below is
// hand-kept in sync with it, same "kept in sync by hand, not importable" shape
// `GENERATED_MODULE_MATCH` (`import-project-module.ts`) already accepts for its own paired
// constant. The `react`/`react-dom`/`preact`/`preact/hooks` half of `@zanix/space`'s own list is
// deliberately excluded here — those are plain npm packages, already declared in `deno.jsonc` for
// an unrelated reason (`command.test.ts`'s own in-process `space build` reachability, documented
// at each entry's own site), and were never the gap this fix closes.
//
// **TODO, once `cli`'s own `@zanix/space` range picks up a version that exports
// `NATIVE_RUNTIME_MODULES` from `./dev`** (added specifically to close this exact hand-sync gap —
// see that export's own doc in `@zanix/space`): replace the hardcoded array below with
// `import { NATIVE_RUNTIME_MODULES } from '@zanix/space/dev'`, filtered to the `@zanix/*` entries
// (`.filter((pkg) => pkg.startsWith('@zanix/'))` — `react`/`preact` stay excluded, same reasoning
// as above). That turns this from "catches a gap someone remembered to mirror here" into "fails
// the instant `@zanix/space` adds a package cli hasn't mirrored yet", with no hand-sync step left
// at all. Not done yet only because the currently-published `@zanix/space` (this repo's own
// `^1.1.0` range) predates that export.
//
// See `cli-dependency-compatibility`'s own "cli's own native-runtime-module declarations" section for
// the checklist this test backs: adding a new `@zanix/*` package to `@zanix/space`'s own
// `NATIVE_RUNTIME_MODULES` needs a matching `deno.jsonc` entry here too, not just
// `ZANIX_DEPENDENCY_VERSIONS`/`PROJECT_TYPE_DEPENDENCIES` (those govern what a GENERATED project
// imports — an entirely separate concern from what `cli`'s OWN process can resolve).
// ================================================================================================

const NATIVE_RUNTIME_ZANIX_PACKAGES = [
  '@zanix/space',
  '@zanix/server',
  '@zanix/auth',
  '@zanix/datamaster',
  '@zanix/asyncmq',
  '@zanix/notifications',
] as const

Deno.test(
  "cli's own deno.jsonc resolves every @zanix/* specifier @zanix/space's nativeRuntimeModulesPlugin " +
    'needs (RealImportEvaluator.runExternalModule does a plain native import() of these against ' +
    "cli's own governing config under zanix space dev, never a scaffolded project's)",
  async () => {
    // `allSettled`, never a `for`/`await` loop — every package resolves independently, and a
    // failure on one must not hide a failure on another (which a plain `try`/`catch` loop already
    // wouldn't, but this also runs them concurrently instead of serially).
    const results = await Promise.allSettled(
      NATIVE_RUNTIME_ZANIX_PACKAGES.map((pkg) => import(pkg)),
    )
    const failures = results
      .map((result, index) =>
        result.status === 'rejected'
          ? `'${NATIVE_RUNTIME_ZANIX_PACKAGES[index]}': ${(result.reason as Error).message}`
          : null
      )
      .filter((failure) => failure !== null)
    assertEquals(
      failures,
      [],
      "Add the missing package(s) to deno.jsonc's own imports map (see the '@zanix/auth' entry " +
        "for the pattern) — see this test file's own module doc for why.",
    )
  },
)
