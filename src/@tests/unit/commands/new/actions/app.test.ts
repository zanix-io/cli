import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { stub } from '@std/testing/mock'
import { Commander } from 'cli'
import newAppAction from 'commands/new/actions/app.ts'

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

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
