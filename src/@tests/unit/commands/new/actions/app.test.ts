import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { stub } from '@std/testing/mock'
import { Commander } from 'cli'
import newAppAction from 'commands/new/actions/app.ts'

// Regression coverage for a confirmed risk: `appName` used to reach `getZanixPaths` with no
// validation at all — a name containing a `..` traversal segment could write outside the intended
// directory. `this.throw` (real `Commander` behavior) rejects instead of writing anything.
Deno.test(
  'newAppAction rejects a project name containing a ".." traversal segment',
  async () => {
    await assertRejects(() =>
      newAppAction.call(new Commander(), { template: 'base' }, '../../etc/cron.d/evil')
    )
  },
)

// Real end-to-end proof, same shape as `space-renderer.test.ts`'s own use of the real action:
// writes to a real, isolated temp directory rather than mocking `createFilesAndFolders`/
// `saveZanixConfig` — the one piece of `newAppAction` worth covering in isolation is the
// `--verify` opt-in branch, never exercised by the functional `commands.new.test.ts` subprocess
// runs (none of them pass `--verify`).
Deno.test(
  'newAppAction should run deno check against the project when --verify is passed',
  async () => {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const appPath = join(root, 'my-app')
    // `--verify` shells out to a real `deno check` via `verifyGeneratedProject` — stubbed here so
    // this test never depends on a real network resolution of the generated project's own
    // `@zanix/app` import (not yet published on JSR — see `deno.jsonc`'s own TEMP note).
    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({ output: () => Promise.resolve({ success: true, stderr: new Uint8Array() }) }) as never,
    )

    try {
      await newAppAction.call(new Commander(), { template: 'base', verify: true }, appPath)

      // 2, not 1: `formatGeneratedProject` (unconditional, `deno fmt`) always runs one subprocess
      // call of its own before `--verify`'s own `deno check` — same stub intercepts both.
      assertEquals(commandStub.calls.length, 2)
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
