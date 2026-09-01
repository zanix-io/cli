import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { stub } from '@std/testing/mock'
import { getTemporaryFolder } from '@zanix/helpers'
import { watchSpaceAppFile } from 'commands/space/dev/action.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

/** Real `Deno.watchFs` event delivery isn't synchronous — polls `predicate` until it's true or
 * `timeoutMs` elapses, rather than a single fixed `sleep` that would either flake under load or
 * waste time waiting when the event already landed. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs}ms`)
    }
    // deno-lint-ignore no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

Deno.test(
  'watchSpaceAppFile: a real write to the watched path triggers onRestart exactly once, then ' +
    're-execs via Deno.Command and exits 0 — never a partial/in-process reload',
  async () => {
    const spaceAppPath = join(await Deno.makeTempDir({ dir: temporaryFolder }), 'space.app.ts')
    await Deno.writeTextFile(spaceAppPath, 'export default {}\n')

    let restartCalls = 0
    let commandArgs: unknown
    let exitCode: number | undefined
    const commandStub = stub(
      Deno,
      'Command',
      (...args: unknown[]) => {
        commandArgs = (args[1] as { args?: unknown } | undefined)?.args
        return { spawn: () => undefined } as never
      },
    )
    const exitStub = stub(Deno, 'exit', (code?: number) => {
      exitCode = code
      return undefined as never
    })

    try {
      watchSpaceAppFile(spaceAppPath, () => {
        restartCalls++
        return Promise.resolve()
      })

      // A real filesystem write — not a simulated event — proves this against the actual
      // `Deno.watchFs` mechanism, not a mocked substitute.
      await Deno.writeTextFile(spaceAppPath, 'export default { name: "changed" }\n')

      await waitFor(() => restartCalls > 0)
      assertEquals(restartCalls, 1)

      await waitFor(() => exitCode !== undefined)
      assertEquals(exitCode, 0)
      assertEquals(commandStub.calls.length, 1)
      assert(Array.isArray(commandArgs))
      assertEquals((commandArgs as string[])[0], 'run')
      assertEquals((commandArgs as string[])[1], '-A')

      // A SECOND write must never trigger a second restart — `restarting` latches after the
      // first real event, same as a real process only ever restarts once before a fresh one
      // takes over.
      await Deno.writeTextFile(spaceAppPath, 'export default { name: "changed-again" }\n')
      await new Promise((resolve) => setTimeout(resolve, 100))
      assertEquals(restartCalls, 1)
    } finally {
      commandStub.restore()
      exitStub.restore()
      await Deno.remove(spaceAppPath)
    }
  },
)

Deno.test(
  'watchSpaceAppFile: onRestart throwing logs an error and exits 1, never lets the throw escape ' +
    'uncaught',
  async () => {
    const spaceAppPath = join(await Deno.makeTempDir({ dir: temporaryFolder }), 'space.app.ts')
    await Deno.writeTextFile(spaceAppPath, 'export default {}\n')

    let exitCode: number | undefined
    const commandStub = stub(Deno, 'Command', () => ({ spawn: () => undefined }) as never)
    const exitStub = stub(Deno, 'exit', (code?: number) => {
      exitCode = code
      return undefined as never
    })

    try {
      watchSpaceAppFile(spaceAppPath, () => Promise.reject(new Error('cleanup failed')))

      await Deno.writeTextFile(spaceAppPath, 'export default { name: "changed" }\n')

      await waitFor(() => exitCode !== undefined)
      assertEquals(exitCode, 1)
      // The re-exec must never even be attempted once cleanup itself failed — respawning a new
      // process while the old servers/engine might still be holding the port would race, not fix,
      // the restart.
      assertEquals(commandStub.calls.length, 0)
    } finally {
      commandStub.restore()
      exitStub.restore()
      await Deno.remove(spaceAppPath)
    }
  },
)
