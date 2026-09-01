import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { stub } from '@std/testing/mock'
import { Commander } from 'cli'
import newSpacecraftAction from 'commands/new/actions/spacecraft.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// Real end-to-end proof, same shape as `space-renderer.test.ts`'s own use of the real action:
// writes to a real, isolated temp directory rather than mocking the tree/side-effect helpers.
// The functional `commands.new.test.ts` subprocess runs never pass an invalid `--renderer` nor
// `--verify`, so neither the catch branch nor the verify branch below is exercised anywhere else.

Deno.test(
  'newSpacecraftAction should throw (never write anything) for an unsupported renderer',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const projectPath = join(root, 'my-spacecraft')
    let thrown: Error | undefined

    try {
      await newSpacecraftAction.call(
        {
          throw: (e: Error) => {
            thrown = e
          },
        } as unknown as Commander,
        { template: 'base', renderer: 'vue' },
        projectPath,
      )

      assert(thrown, 'expected this.throw to have been called')
      assertEquals(
        thrown?.message,
        "Unsupported renderer 'vue'. Supported renderers: react, preact.",
      )
      assertEquals(
        await Deno.stat(projectPath).then(() => true).catch(() => false),
        false,
        'nothing should have been written for an unsupported renderer',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'newSpacecraftAction should run deno check against the project when --verify is passed',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const projectPath = join(root, 'my-spacecraft')
    // `--verify` shells out to a real `deno check` via `verifyGeneratedProject` — stubbed here so
    // this test never depends on a real network resolution of the generated project's own
    // `@zanix/app`/`@zanix/space` imports (not yet published on JSR — see `deno.jsonc`'s own TEMP
    // note).
    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({ output: () => Promise.resolve({ success: true, stderr: new Uint8Array() }) }) as never,
    )

    try {
      await newSpacecraftAction.call(
        new Commander(),
        { template: 'base', verify: true },
        projectPath,
      )

      // 2, not 1: `formatGeneratedProject` (unconditional, `deno fmt`) always runs one subprocess
      // call of its own before `--verify`'s own `deno check` — same stub intercepts both.
      assertEquals(commandStub.calls.length, 2)
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
