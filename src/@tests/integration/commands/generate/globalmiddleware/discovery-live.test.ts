import { assert } from '@std/assert'
import { dirname } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  GLOBAL_MIDDLEWARE_TYPES,
  planGlobalMiddleware,
} from 'commands/generate/globalmiddleware/command.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * A real, end-to-end regression test for `planGlobalMiddleware`'s `.defs.ts` suffix scheme
 * (`command.ts`) — a real `deno run` subprocess, against real, currently-published
 * `@zanix/core@^3.0.0`/`@zanix/server@^4.0.0` (both verified live to resolve, and `@zanix/server`
 * to already export `registerGlobalPipe`/`registerGlobalGuard`/`registerGlobalInterceptor` at its
 * root — no local checkout override needed), running a real `Zanix.compose(rootDir)` — the exact
 * function `@zanix/core`'s `Zanix.start()` itself wraps for its own project-file auto-discovery.
 *
 * Same technique as `handler/discovery-live.test.ts`/`subscriber/discovery-live.test.ts`: each
 * kind's real, generated content (`planGlobalMiddleware`'s own `content()`) is written under its
 * real file name, with one extra top-level `console.log(MARKER)` appended (harmless — runs once,
 * at import time, right after the real `registerGlobal<Kind>` call succeeds) so this test can
 * observe, from the subprocess's own stdout, whether `Zanix.compose` actually imported AND
 * successfully evaluated that file — proving both the auto-discovery step and that
 * `registerGlobalPipe`/`registerGlobalGuard`/`registerGlobalInterceptor` don't throw against the
 * real generated shape, all three kinds coexisting in the same `shared/middlewares/` folder.
 *
 * The second `Deno.test` below is the negative control that makes the first one meaningful: the
 * SAME marker lines, under a bare `.pipe.ts`/`.guard.ts`/`.interceptor.ts` suffix (no `.defs.ts` at
 * all — none of `@zanix/server`'s real `ZANIX_SERVER_MODULES` suffixes), never print.
 *
 * @module
 */

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await Deno.writeTextFile(path, content)
}

async function writeScaffoldDenoJson(root: string): Promise<void> {
  await writeFile(
    `${root}/deno.json`,
    JSON.stringify({
      imports: {
        '@zanix/core': 'jsr:@zanix/core@^3.0.0',
        '@zanix/server': 'jsr:@zanix/server@^4.0.0',
      },
    }),
  )
}

/** A distinct, valid pascal-cased identifier per `--kind`. */
const PROBE_NAMES: Record<string, string> = {
  pipe: 'ProbePipe',
  guard: 'ProbeGuard',
  interceptor: 'ProbeInterceptor',
}

async function runCompose(root: string): Promise<string> {
  await writeFile(
    `${root}/compose.ts`,
    `import Zanix from '@zanix/core'\nawait Zanix.compose('.')\nconsole.log('COMPOSE_DONE')\n`,
  )

  const { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--min-dep-age', '0', 'compose.ts'],
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).output()

  const out = new TextDecoder().decode(stdout)
  assert(success, `compose.ts subprocess failed:\n${new TextDecoder().decode(stderr)}\n${out}`)
  assert(out.includes('COMPOSE_DONE'), `Zanix.compose never completed:\n${out}`)
  return out
}

Deno.test(
  'a real deno run subprocess (Zanix.compose) auto-discovers every zanix generate ' +
    'globalmiddleware --kind shape, at its real generated .defs.ts file name',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)

      const middlewaresFolder = `${root}/shared/middlewares`
      const markers = Object.keys(GLOBAL_MIDDLEWARE_TYPES).map((kind) => `DISCOVERED:${kind}`)

      for (const kind of Object.keys(GLOBAL_MIDDLEWARE_TYPES)) {
        const plan = planGlobalMiddleware(
          `probe-${kind}`,
          PROBE_NAMES[kind],
          kind,
          middlewaresFolder,
        )
        const file = plan.files[0]
        // deno-lint-ignore no-await-in-loop
        const content = await file.content()
        // deno-lint-ignore no-await-in-loop
        await writeFile(file.PATH, `${content}\nconsole.log('DISCOVERED:${kind}')\n`)
      }

      const out = await runCompose(root)

      for (const marker of markers) {
        assert(out.includes(marker), `expected ${marker} in subprocess stdout:\n${out}`)
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'negative control: a bare .pipe.ts/.guard.ts/.interceptor.ts suffix (no .defs.ts) is never ' +
    'auto-discovered by Zanix.compose — proving this generator (and this test) actually matter',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)

      const bareSuffixes: Record<string, string> = {
        pipe: 'pipe',
        guard: 'guard',
        interceptor: 'interceptor',
      }

      for (const [kind, suffix] of Object.entries(bareSuffixes)) {
        // deno-lint-ignore no-await-in-loop
        await writeFile(
          `${root}/shared/middlewares/probe-${kind}.${suffix}.ts`,
          `console.log('DISCOVERED:${kind}')\n`,
        )
      }

      const out = await runCompose(root)

      for (const kind of Object.keys(bareSuffixes)) {
        assert(
          !out.includes(`DISCOVERED:${kind}`),
          `expected the bare '${kind}' suffix to NOT be auto-discovered, but it was:\n${out}`,
        )
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
