import { NATIVE_FRESHNESS_REEXEC_ENV } from 'commands/space/shared/native-dependency-freshness.ts'

/**
 * Sets `native-dependency-freshness-guard.ts`'s own re-exec guard env var so `spaceDevAction`/
 * `spaceBuildAction` never call `Deno.exit()` during a real, direct `actionHandler(...)` call under
 * `deno test` — that mechanism's own real trigger (whether `@zanix/cli`'s own committed lock
 * happens to be behind the latest published `@zanix/server`/`@zanix/app` at the moment a given test
 * runs) is external, time-varying registry state no test should depend on to avoid crashing
 * outright ("Test case attempted to exit", `deno test`'s own sandboxing).
 *
 * Call once, at module scope (env vars are process-wide, so a single call per test FILE is
 * enough), in every test file that boots a real `zanix space dev`/`build` action —
 * `native-dependency-freshness.test.ts` is where that mechanism gets its own dedicated coverage.
 */
export function disableNativeFreshnessCheckForTests(): void {
  Deno.env.set(NATIVE_FRESHNESS_REEXEC_ENV, '1')
}
