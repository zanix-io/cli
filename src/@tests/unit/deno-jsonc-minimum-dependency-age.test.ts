import { assertEquals } from '@std/assert'
import { parse as parseJsonc } from '@std/jsonc'
import { fromFileUrl } from '@std/path'

/**
 * Locks in the real fix for a confirmed, reproduced-live bug: `zanix space dev`/`build`, run from
 * a real global `deno install -g jsr:@zanix/cli` install, rejected a real, already-published
 * `@zanix/server` release with `Could not find version of '@zanix/server' that matches specified
 * version constraint '^4.2.1' ... newer than the specified minimum dependency date` — even though
 * the SERVED project's own `deno.json` already set `"minimumDependencyAge": 0`.
 *
 * The failing resolution was of `@zanix/cli`'s OWN static `@zanix/server` import
 * (`commands/space/dev/action.ts`'s own `from '@zanix/server'`), not the served project's — a
 * served project's own `minimumDependencyAge` only ever governs its own dependency graph, never
 * this package's. `@zanix/cli` needs its own `"minimumDependencyAge": 0` for its own dependency
 * resolution to stay unblocked by Deno's default freshness gate, since this package tracks
 * same-day published `@zanix/*` releases as a matter of course. Re-installing the CLI itself with
 * `--min-dep-age 0` does NOT substitute for this — that flag only affects `deno install`'s own
 * one-time resolution of `@zanix/cli`'s dependency graph at install time, not the dependency
 * resolution `zanix` performs on every subsequent invocation.
 */
Deno.test(
  "deno.jsonc sets minimumDependencyAge: 0, so this package's own dependency resolution " +
    "is never blocked by Deno's default freshness gate",
  async () => {
    const denoJsoncPath = fromFileUrl(new URL('../../../deno.jsonc', import.meta.url))
    const config = parseJsonc(await Deno.readTextFile(denoJsoncPath)) as {
      minimumDependencyAge?: number
    }
    assertEquals(
      config.minimumDependencyAge,
      0,
      'deno.jsonc no longer sets "minimumDependencyAge": 0 — this regresses back to Deno\'s ' +
        "default freshness gate blocking this package's own dependency resolution (e.g. " +
        "@zanix/server) once a fresh version publishes, exactly like the bug this test's own doc " +
        'describes.',
    )
  },
)
