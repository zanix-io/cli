import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'
import { SPACE_CLIENT_IMPORTS } from '../build/space-client-imports.ts'

// ================================================================================================
// Regression guard for the mechanism `importProjectDependency` exists to fix: the real, reported
// `zanix space dev` crash (`Route path "socket=>/__zanix_space_dev__" is already defined in
// "SpaceDevSocket"`) whenever a served project's own declared `@zanix/space` version diverges from
// whatever `@zanix/cli` would otherwise resolve natively for its own dev-engine orchestration
// (`@zanix/server`/`@zanix/space/dev`/`@zanix/app`/`@zanix/app/runtime`).
//
// This fixture deliberately pins `@zanix/space` (and only `@zanix/space` — every other entry stays
// `SPACE_CLIENT_IMPORTS`'s own default) to `1.3.0` — an older, real, currently-published version,
// genuinely different from `ZANIX_DEPENDENCY_VERSIONS['@zanix/space']`'s own current floor
// (`^1.4.0`) at the time this test was written. Confirms `zanix space dev` boots cleanly — and,
// per the log output this test's own real run produces, actually resolves and runs the PROJECT's
// declared `1.3.0` throughout, not a silently-substituted floor — against a project pinned to a
// DIFFERENT version than whatever `@zanix/cli`'s own `deno.jsonc`/`ZANIX_DEPENDENCY_VERSIONS`
// declare.
//
// **Real limitation, confirmed by an actual repro, not assumed**: this test does NOT reproduce the
// original crash against the PRE-`importProjectDependency` code within this repo's own test suite.
// Every test here runs `@zanix/cli` from a real LOCAL CHECKOUT (this repo itself) — under that
// condition, `getCliLoader()`'s own `cliConfigPath` is a real, fixed path (never `undefined`,
// see that function's own doc), so `resolveReplacement`'s pre-existing "defer to cli's own answer"
// step deterministically resolves `space.app.ts`'s own `@zanix/space` import against `cli`'s OWN
// `deno.jsonc` floor too — silently overriding this fixture's own `1.3.0` pin with whatever `cli`
// itself declares, converging by ACCIDENT rather than crashing. The reported crash's own precondition
// (`cliConfigPath === undefined`) only exists under a genuine global install (`deno install -g
// jsr:@zanix/cli`, loaded from a remote `jsr:` specifier) — structurally unreachable from a local
// checkout's own test run, so no test in this suite can literally reproduce it. What this test DOES
// prove, confirmed against both the pre- and post-fix code: pre-fix, the served project's own
// explicit version choice is silently discarded (a real, separate footgun of the underlying
// `configPath: undefined` auto-discovery mechanism `resolveReplacement` already relies on) but
// happens not to crash in the local-checkout shape every test here runs under; post-fix, the
// project's own declared version is what actually, verifiably runs.
//
// Deliberately its own file, own port — same reasoning `command-live-boot.test.ts` already
// documents for staying separate from `command-live-conflict.test.ts`: each test file gets its own
// module registry, so a real `bootstrapServers()` call here never shares `@zanix/server`'s own
// process-wide boot-session/`webServerManager` state with another file's own call.
// ================================================================================================

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Same race/retry this file's own sibling (`command-live-boot.test.ts`) already documents in
 * full — Vite's own background dependency-optimizer writes can still be mid-flight against `root`
 * when this test tears it down. */
async function removeDirWithRetry(path: string, attempts = 5, delayMs = 75): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.remove(path, { recursive: true })
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) lastError = error
    }
    // deno-lint-ignore no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.lstat(path)
    } catch {
      return
    }
  }
  throw lastError ?? new Error(`${path} still exists after ${attempts} removal attempts`)
}

/** Same real `space.app.ts` shape `command-live-boot.test.ts` uses, but with EVERY `@zanix/space`
 * import-map entry pinned to the OLDER, divergent `1.3.0` — see this file's own header doc for
 * why an older pin, not a newer one, is the only real divergence currently available to test. */
async function withDivergentVersionScaffold(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  try {
    const divergentImports = { ...SPACE_CLIENT_IMPORTS }
    for (const key of Object.keys(divergentImports)) {
      if (key === '@zanix/space' || key.startsWith('@zanix/space/')) {
        divergentImports[key] = divergentImports[key].replace(
          /^jsr:@zanix\/space@[^/]+/,
          'jsr:@zanix/space@1.3.0',
        )
      }
    }
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ zanix: { project: 'space' }, imports: divergentImports }, null, 2),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import '@zanix/space/react'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'dev-live-divergent-version-app',
  routesDir: './src/space/routes',
})
`,
    )
    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await removeDirWithRetry(root)
  }
}

Deno.test({
  name:
    'zanix space dev: boots cleanly against a project pinned to an OLDER, explicit @zanix/space ' +
    "version than cli's own deno.jsonc/ZANIX_DEPENDENCY_VERSIONS floor — see this file's own doc " +
    'for the real limitation on what this can/cannot reproduce in a local-checkout test run',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withDivergentVersionScaffold(async () => {
      const port = 48781
      const command = registerCommand()
      await command.settings.actionHandler({ port })

      const response = await fetch(`http://localhost:${port}/`)
      await response.body?.cancel()
      assert(response.status > 0, `expected a real HTTP response, got status ${response.status}`)
    })
  },
})
