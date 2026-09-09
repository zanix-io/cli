import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  detectTransitiveCollisionPackages,
  prepareTransitiveCollisionReexec,
} from 'commands/space/shared/transitive-collision.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * End-to-end proof, against real, currently-published packages, of the fix for a confirmed bug:
 * `@zanix/server` can load as TWO separate module instances when a served project imports it
 * directly AND transitively through a third-party `@zanix/*` package it also imports directly —
 * `@zanix/datamaster` is the real, reported case (its own published `deno.jsonc` declares
 * `"@zanix/server": "jsr:@zanix/server@^4.0.0"`).
 *
 * `-live` in this file's own name, matching this directory's sibling convention
 * (`graphql-check-schema-live.test.ts`): depends on real, currently-published `@zanix/server`/
 * `@zanix/datamaster`, resolved fresh from JSR — no synthetic stand-in, since the whole point is
 * proving the REAL packages' REAL manifests converge under the fix.
 *
 * This deliberately does NOT drive `guardAgainstTransitiveCollisions`/`Deno.space dev` directly —
 * that function calls `Deno.exit()` on a genuine collision, which would kill this entire `deno
 * test` process (every `command-live-boot-*.test.ts` sibling runs `actionHandler` IN-PROCESS, never
 * via a subprocess, so a `Deno.exit()` there is untestable in-process by construction). Instead,
 * this exercises the two SAFE, side-effect-free pieces directly:
 *
 * 1. `detectTransitiveCollisionPackages` — confirms it actually flags `@zanix/server` for this
 *    exact real pairing.
 * 2. `prepareTransitiveCollisionReexec` — confirms the MERGED config it produces is genuinely
 *    usable: a real, separate subprocess (simulating `@zanix/cli`'s own differently-configured
 *    process under a global install) spawned with `--config <that merged path>` and NO other
 *    knowledge of this fixture project can still resolve the fixture's own bare `@zanix/server`
 *    import AND converge it with `@zanix/datamaster`'s own internal one — proven with a REAL
 *    `instanceof` check (`ZanixCacheCoreProvider.prototype instanceof ZanixProvider`), the exact
 *    shape the original bug report's own repro used.
 *
 * **Real limitation, confirmed empirically, matching this suite's own honest convention** (see
 * `command-live-boot-divergent-space-version.test.ts`'s own doc for the sibling case): this test
 * cannot reproduce the ORIGINAL bug's own crash from within this repo's local checkout, since doing
 * so would require actually driving `guardAgainstTransitiveCollisions`'s `Deno.exit()` path, which
 * is untestable in-process (see above). What it DOES prove, against the real published packages:
 * the config `prepareTransitiveCollisionReexec` produces is exactly what a re-exec'd process needs
 * to converge both edges onto one module instance.
 */

async function withFixtureProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({
        imports: {
          '@zanix/server': 'jsr:@zanix/server@^4.0.0',
          '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.0',
        },
      }),
    )
    await Deno.writeTextFile(
      join(root, 'entry.ts'),
      `import { ZanixProvider } from '@zanix/server'
import { ZanixCacheCoreProvider } from '@zanix/datamaster/cache'

console.log(ZanixCacheCoreProvider.prototype instanceof ZanixProvider)
`,
    )
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'detectTransitiveCollisionPackages + prepareTransitiveCollisionReexec: a real project directly ' +
    "importing @zanix/server AND @zanix/datamaster gets a merged config that, once a re-exec'd " +
    'process runs under it, actually converges both to ONE @zanix/server instance ' +
    '(instanceof true) — the real reported bug, fixed',
  async () => {
    await withFixtureProject(async (root) => {
      const collisions = await detectTransitiveCollisionPackages(root)
      assert(
        collisions.has('@zanix/server'),
        `expected '@zanix/server' to be flagged (found: ${[...collisions].join(', ') || '(none)'})`,
      )

      const mergedConfigPath = await prepareTransitiveCollisionReexec(root)
      assert(mergedConfigPath !== undefined, 'expected a merged config path for a flagged project')

      // A separate subprocess, simulating @zanix/cli's own differently-configured process under a
      // real global install — it has NO knowledge of `root` beyond the `--config` flag itself.
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', '--config', mergedConfigPath as string, join(root, 'entry.ts')],
        stdout: 'piped',
        stderr: 'piped',
      })
      const { success, stdout, stderr } = await command.output()
      const stdoutText = new TextDecoder().decode(stdout).trim()
      assert(
        success,
        `expected the re-exec'd process to boot successfully; stderr: ${
          new TextDecoder().decode(stderr)
        }`,
      )
      assertEquals(
        stdoutText,
        'true',
        `expected 'true' (one converged module instance) — the re-exec'd process printed ` +
          `'${stdoutText}' instead, meaning @zanix/server and @zanix/datamaster's own internal ` +
          'dependency on it resolved to two separate instances even under the merged config.',
      )
    })
  },
)
