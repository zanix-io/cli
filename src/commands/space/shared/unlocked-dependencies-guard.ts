import logger from '@zanix/utils/logger'

/**
 * Runs `deno install` in `root` at the start of `zanix space build`/`dev`, before anything resolves
 * a project specifier (the same startup slot as `guardAgainstTransitiveCollisions` and
 * `guardAgainstStaleNativeDependencies`, for a different hazard).
 *
 * The generated `dev` task (`getBaseTasks`, `utils/config/base.ts`) already prefixes `deno
 * install`, so for `dev` this guard covers a direct `zanix space dev` invocation that bypasses the
 * task. The generated `build` task has no such prefix, so `build` depends on this guard in every
 * invocation.
 *
 * Without a lockfile, nothing forces every specifier in the graph through one resolution pass, so
 * two version-sensitive npm packages (`react`/`react-dom`, which React requires to match exactly)
 * can resolve to different versions even when `root`'s `deno.json` and a dependency's manifest
 * (e.g. `@zanix/space`'s) declare the same range for both: one resolves through `root`'s import,
 * the other through the dependency's peer-qualified npm resolution, each taking the newest
 * satisfying version at that moment. `deno install` resolves `root`'s whole graph in one pass and
 * writes `deno.lock`/`node_modules` from it, so every specifier converges on one resolution.
 *
 * The process is never restarted: `root`'s `deno.lock` and `node_modules` only need to exist on
 * disk before this process's `importSpaceApp` call resolves the project's dependencies, whereas
 * the two sibling guards change what governs `@zanix/cli`'s own module graph, which a `--config`/
 * `--lock` flag sets only at process start.
 */
export async function guardAgainstUnlockedDependencies(root: string): Promise<void> {
  const install = new Deno.Command(Deno.execPath(), {
    args: ['install'],
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
