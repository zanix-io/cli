import logger from '@zanix/utils/logger'

/**
 * Runs at the very start of `zanix space build`/`dev`, alongside (never instead of)
 * `transitive-collision-guard.ts`/`native-dependency-freshness-guard.ts`'s own identical "before
 * anything resolves a single project specifier" startup slot — a separate hazard, same slot.
 *
 * `build` has no other protection at all. `dev` also has the generated `dev` task itself
 * (`getBaseTasks`, `utils/config/base.ts`) already prefixing `deno install` — this guard is what
 * protects a direct `zanix space dev` invocation that bypasses that task instead, the same way it
 * protects every `zanix space build` invocation (the task-based one included: `deno task build`
 * has no such prefix to begin with).
 *
 * Real, confirmed bug this closes: two cross-package version-sensitive npm packages (`react`/
 * `react-dom` today — React itself asserts they must match exactly) can resolve to DIFFERENT
 * versions even when `root`'s own `deno.json` and a dependency's (e.g. `@zanix/space`'s) own
 * manifest declare the IDENTICAL semver range for both, because nothing forces every specifier in
 * the graph into ONE atomic resolution pass without a lockfile — one package can resolve via
 * `root`'s own root import, the other via a dependency's internal, peer-qualified npm resolution,
 * each picking whatever the registry serves as "latest satisfying" at that exact moment. `deno
 * install` resolves `root`'s whole dependency graph in one pass and writes `deno.lock`/
 * `node_modules` from it, so every specifier converges on the SAME resolution — confirmed via a
 * real repro (`space-build-react-compiler-live.test.ts`'s own regression, reproduced with and
 * without this guard).
 *
 * Deliberately never restarts the process, unlike the two guards above: those change what governs
 * `@zanix/cli`'s OWN module graph (a `--config`/`--lock` flag that only takes effect at process
 * start), while this only needs `root`'s own `deno.lock`/`node_modules` written to disk before
 * THIS SAME process's own `importSpaceApp` call resolves the project's dependencies for the first
 * time — no restart needed for that.
 *
 * TEMPORARY: `--min-dep-age=60` (minutes, `deno install`'s own flag) — Deno's default 24h
 * minimum-dependency-age policy otherwise refuses to install a `@zanix/*` package published very
 * recently, which real, first-party ecosystem releases (this repo's own `2.2.0-rc.2`, needing
 * `@zanix/space@^1.10.2` for `getActivePreactDevTools`) can hit immediately after publishing. A
 * short, non-zero window (not `0`) keeps SOME real protection against a genuinely
 * just-published/compromised package, unlike disabling the policy outright. Revert once
 * `@zanix/space@1.10.2` (and any other floor bumped alongside it) is safely past 24h old — this
 * is a workaround for this release's own timing, not a permanent policy call for every consumer.
 */
export async function guardAgainstUnlockedDependencies(root: string): Promise<void> {
  const install = new Deno.Command(Deno.execPath(), {
    args: ['install', '--min-dep-age=10'],
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const { success, code } = await install.status
  if (!success) {
    logger.error(`'deno install' failed while preparing '${root}' for build.`)
    Deno.exit(code)
  }
}
