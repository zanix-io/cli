import { assert } from '@std/assert'
import { dirname } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { planSubscriber } from 'commands/generate/subscriber/command.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * A real, end-to-end regression test for `planSubscriber`'s `.subscriber.handler.ts` suffix
 * (`command.ts`) — a real `deno run` subprocess, against real, currently-published
 * `@zanix/core@^3.0.0`/`@zanix/asyncmq@^0.8.0` (both verified live to resolve, and `@zanix/asyncmq`
 * to already export `Subscriber`/`ZanixSubscriber` at its root — no local checkout override
 * needed), running a real `Zanix.compose(rootDir)`.
 *
 * `Zanix.compose` (not `Zanix.startWorker()`) is what this test drives — `Zanix.startWorker()`
 * itself never resolves (it awaits `SIGINT`/`SIGTERM` forever, by design), but it shares the exact
 * same underlying file-discovery primitive: `@zanix/asyncmq/worker`'s `workerFileTypes()` is just
 * `@zanix/server`'s real `ZANIX_SERVER_MODULES` (unfiltered for a non-internal-process caller,
 * which is what this subprocess is), and `Zanix.compose`'s own `defineLocalMetadata(rootDir)` call
 * uses that SAME unfiltered `ZANIX_SERVER_MODULES` list by default — so proving a file gets
 * auto-imported here proves the identical suffix-matching step `startWorker()` itself depends on.
 *
 * The bug this guards against: the real, generated subscriber content (`planSubscriber`'s own
 * `content()`) is written under its real file name, with one extra top-level `console.log(MARKER)`
 * appended (harmless — runs once, at import time, alongside the real `@Subscriber` decorator) so
 * this test can observe, from the subprocess's own stdout, whether `Zanix.compose` actually
 * imported that file at all.
 *
 * The second `Deno.test` below is the negative control that makes the first one meaningful: the
 * SAME marker line, under the OLD, pre-fix bare `.subscriber.ts` suffix, never prints — proving
 * this test would have caught the original bug (see `planSubscriber`'s own doc in `command.ts` for
 * the full mechanism).
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
        '@zanix/asyncmq': 'jsr:@zanix/asyncmq@^0.8.0',
      },
    }),
  )
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
  'a real deno run subprocess (Zanix.compose) auto-discovers a zanix generate subscriber, at its ' +
    'real generated .subscriber.handler.ts file name',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)

      const plan = planSubscriber(
        'probe-subscriber',
        'ProbeSubscriber',
        undefined,
        `${root}/subscribers`,
      )
      const file = plan.files[0]
      const content = await file.content()
      await writeFile(file.PATH, `${content}\nconsole.log('DISCOVERED:subscriber')\n`)

      const out = await runCompose(root)

      assert(
        out.includes('DISCOVERED:subscriber'),
        `expected DISCOVERED:subscriber in subprocess stdout:\n${out}`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'negative control: the OLD, pre-fix bare .subscriber.ts suffix is never auto-discovered by ' +
    'Zanix.compose — proving the fix (and this test) actually matter',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeScaffoldDenoJson(root)

      await writeFile(
        `${root}/subscribers/probe-subscriber.subscriber.ts`,
        `console.log('DISCOVERED:subscriber')\n`,
      )

      const out = await runCompose(root)

      assert(
        !out.includes('DISCOVERED:subscriber'),
        `expected the OLD .subscriber.ts suffix to NOT be auto-discovered, but it was:\n${out}`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
