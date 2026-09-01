import { assert } from '@std/assert'
import { dirname } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { HANDLER_TYPES, planHandler } from 'commands/generate/handler/command.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * A real, end-to-end regression test for `HANDLER_TYPES`'s own suffix scheme (`command.ts`) — a
 * real `deno run` subprocess, against real, currently-published `@zanix/core@^3.0.0`/
 * `@zanix/server@^4.0.0`/`@zanix/server@^4.0.0/graphql` (all verified live to resolve and to
 * already export everything the 4 handler templates need — `Controller`/`Get`/`ZanixController`,
 * `Resolver`/`Query`/`ZanixResolver`, `Socket`/`ZanixWebSocket`, `SsrController`/
 * `ZanixSsrController` — no local checkout override needed, unlike `graphql-check-schema-live.
 * test.ts`'s own `getSchema`/`defineSchema` check, which genuinely does need one), running a real
 * `Zanix.compose(rootDir)` — the exact function `@zanix/core`'s `Zanix.start()` itself wraps for
 * its own project-file auto-discovery.
 *
 * The bug this guards against: `planHandler`'s real, generated content is written under `planHandler`'s
 * own real file name for each `--type`, with one extra top-level `console.log(MARKER)` appended
 * (harmless — it runs once, at import time, alongside the real decorator registration) so this test
 * can observe, from the subprocess's own stdout, whether `Zanix.compose` actually imported that file
 * at all — proving the auto-discovery step itself, not just that the generated content is
 * syntactically valid (already covered by `handler/command.test.ts`'s unit tests).
 *
 * The second `Deno.test` below is the negative control that makes the first one meaningful: the
 * SAME marker lines, under the OLD, pre-fix suffixes (`.resolver.ts`/`.socket.ts`/`.ssr.ts` — no
 * `.handler.ts` at all), never print — proving `Zanix.compose` genuinely never imported those
 * files, i.e. that this test would have caught the original bug (see `HANDLER_TYPES`'s own doc in
 * `command.ts` for the full mechanism: `@zanix/server`'s real `ZANIX_SERVER_MODULES` only
 * recognizes `.handler.ts`/`.interactor.ts`/`.connector.ts`/`.provider.ts`/`.defs.ts`, matched via
 * a plain `endsWith`, not exact-match).
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
        '@zanix/server/graphql': 'jsr:@zanix/server@^4.0.0/graphql',
        graphql: 'npm:graphql@16',
      },
    }),
  )
}

/** A distinct, valid pascal-cased identifier per `--type`, so each generated class name is unique
 * even though every probe file lives in the same `handlers/` folder. */
const PROBE_NAMES: Record<string, string> = {
  rest: 'ProbeRest',
  graphql: 'ProbeGraphql',
  socket: 'ProbeSocket',
  ssr: 'ProbeSsr',
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
  'a real deno run subprocess (Zanix.compose) auto-discovers every zanix generate handler ' +
    '--type shape, at its real generated file name',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)

      const handlersFolder = `${root}/handlers`
      const markers = Object.keys(HANDLER_TYPES).map((type) => `DISCOVERED:${type}`)

      for (const type of Object.keys(HANDLER_TYPES)) {
        const plan = planHandler(`probe-${type}`, PROBE_NAMES[type], type, handlersFolder)
        const file = plan.files[0]
        // deno-lint-ignore no-await-in-loop
        const content = await file.content()
        // deno-lint-ignore no-await-in-loop
        await writeFile(file.PATH, `${content}\nconsole.log('DISCOVERED:${type}')\n`)
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
  'negative control: the OLD, pre-fix non-.handler.ts suffixes (.resolver.ts/.socket.ts/.ssr.ts) ' +
    'are never auto-discovered by Zanix.compose — proving the fix (and this test) actually matter',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)

      const oldSuffixes: Record<string, string> = {
        graphql: 'resolver',
        socket: 'socket',
        ssr: 'ssr',
      }

      for (const [type, suffix] of Object.entries(oldSuffixes)) {
        // deno-lint-ignore no-await-in-loop
        await writeFile(
          `${root}/handlers/probe-${type}.${suffix}.ts`,
          `console.log('DISCOVERED:${type}')\n`,
        )
      }

      const out = await runCompose(root)

      for (const type of Object.keys(oldSuffixes)) {
        assert(
          !out.includes(`DISCOVERED:${type}`),
          `expected the OLD suffix for '${type}' to NOT be auto-discovered, but it was:\n${out}`,
        )
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
