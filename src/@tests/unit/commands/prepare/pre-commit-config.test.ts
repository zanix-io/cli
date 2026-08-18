import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { createPreCommitYaml } from 'commands/prepare/lib/github/files/pre-commit-config.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// `prepareGithubAction` (see `github.test.ts`) already covers the real, `pre-commit`-installed
// happy path on THIS machine — this stubs `Deno.Command` directly (never the real `pre-commit`
// binary/`PATH`) to exercise the "not installed" warn branch, which the real environment here
// never takes on its own.
Deno.test(
  'createPreCommitYaml warns and skips autoupdate when pre-commit is not installed',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    await Deno.mkdir(root, { recursive: true })

    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({ output: () => Promise.resolve({ success: false, stderr: new Uint8Array() }) }) as never,
    )

    try {
      const created = await createPreCommitYaml({ baseRoot: root })

      assert(created)
      // Only the `install` call should have happened — `autoupdate` is only ever run when
      // `install` succeeds.
      assertEquals(commandStub.calls.length, 1)
      assertEquals(commandStub.calls[0].args[0], 'pre-commit')
      assertEquals((commandStub.calls[0].args[1] as { args: string[] }).args, ['install'])
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
