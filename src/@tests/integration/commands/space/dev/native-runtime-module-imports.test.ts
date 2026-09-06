import { assertEquals } from '@std/assert'
import { NATIVE_RUNTIME_MODULES } from '@zanix/space/dev'

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
// any package `@zanix/space` adds to its own list.
//
// `NATIVE_RUNTIME_MODULES` is imported directly from `@zanix/space/dev` (real reference, not a
// hand-kept copy) — `cli`'s own `@zanix/space` range picked up the version that exports it a while
// ago, closing what used to be a hand-sync gap: this test now fails the instant `@zanix/space` adds
// a package `cli` hasn't mirrored in its own `deno.jsonc`, with no step left that depends on someone
// remembering to update a duplicate list here. The `react`/`react-dom`/`preact`/`preact/hooks` half
// of that list is deliberately excluded below — those are plain npm packages, already declared in
// `deno.jsonc` for an unrelated reason (`command.test.ts`'s own in-process `space build`
// reachability, documented at each entry's own site), and were never the gap this test closes.
//
// See `cli-dependency-compatibility`'s own "cli's own native-runtime-module declarations" section for
// the checklist this test backs: adding a new `@zanix/*` package to `@zanix/space`'s own
// `NATIVE_RUNTIME_MODULES` needs a matching `deno.jsonc` entry here too, not just
// `ZANIX_DEPENDENCY_VERSIONS`/`PROJECT_TYPE_DEPENDENCIES` (those govern what a GENERATED project
// imports — an entirely separate concern from what `cli`'s OWN process can resolve).
// ================================================================================================

const NATIVE_RUNTIME_ZANIX_PACKAGES = NATIVE_RUNTIME_MODULES.filter((pkg) =>
  pkg.startsWith('@zanix/')
)

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
