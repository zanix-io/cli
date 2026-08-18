import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { stub } from '@std/testing/mock'
import { Commander } from 'cli'
import newSpaceAction from 'commands/new/actions/space.ts'

// `space-renderer.test.ts` already covers the renderer-wiring paths through this same real
// action. The one branch never exercised anywhere: `--verify`.
Deno.test(
  'newSpaceAction should run deno check against the project when --verify is passed',
  async () => {
    const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    const appPath = join(root, 'my-space')
    // `--verify` shells out to a real `deno check` via `verifyGeneratedProject` — stubbed here so
    // this test never depends on a real network resolution of the generated project's own
    // `@zanix/space` import (not yet published on JSR — see `deno.jsonc`'s own TEMP note).
    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({ output: () => Promise.resolve({ success: true, stderr: new Uint8Array() }) }) as never,
    )

    try {
      await newSpaceAction.call(new Commander(), { template: 'base', verify: true }, appPath)

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
