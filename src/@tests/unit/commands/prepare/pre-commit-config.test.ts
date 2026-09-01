import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'
import logger from '@zanix/logger'
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

// A7 regression: a genuinely absent `pre-commit` binary makes the spawn itself reject with
// `Deno.errors.NotFound` (not a resolved `{ success: false }`, the case above) — confirmed this
// used to propagate straight through `createPreCommitYaml` as a raw, uncaught rejection, which in
// turn made `prepareGithub`'s own `Promise.all` reject early, hiding whether
// `createPreCommitHook`/`createPrePushHook` (running concurrently in that same array) actually
// succeeded. This must resolve normally, logging the same friendly "please install pre-commit"
// warning as the `!success` case above, and `.pre-commit-config.yaml` must still be written.
Deno.test(
  'createPreCommitYaml warns the friendly message and does not throw when the pre-commit binary is absent from PATH',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    await Deno.mkdir(root, { recursive: true })

    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({
          output: () =>
            Promise.reject(
              new Deno.errors.NotFound("Failed to spawn 'pre-commit': entity not found"),
            ),
        }) as never,
    )
    const warnStub = stub(logger, 'warn')

    try {
      const created = await createPreCommitYaml({ baseRoot: root })

      assert(created)
      assert(await fileExists(`${root}/.pre-commit-config.yaml`))
      // Only the `install` call should have happened — the rejection means `install` is never
      // considered successful, so `autoupdate` never runs either.
      assertEquals(commandStub.calls.length, 1)
      assertEquals(warnStub.calls.length, 1)
      assertStringIncludes(
        String(warnStub.calls[0].args[0]),
        'It seems pre-commit is not installed.',
      )
    } finally {
      commandStub.restore()
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

// A7 regression: an unexpected spawn-time failure that ISN'T the binary being absent (e.g.
// permission denied) must not be conflated with "please install pre-commit" — that advice
// wouldn't fix a different underlying problem — and must not throw either.
Deno.test(
  'createPreCommitYaml warns a distinct, error-naming message (without throwing) for a non-NotFound spawn failure',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    await Deno.mkdir(root, { recursive: true })

    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({
          output: () =>
            Promise.reject(new Deno.errors.PermissionDenied('Permission denied (os error 13)')),
        }) as never,
    )
    const warnStub = stub(logger, 'warn')

    try {
      const created = await createPreCommitYaml({ baseRoot: root })

      assert(created)
      assert(await fileExists(`${root}/.pre-commit-config.yaml`))
      assertEquals(commandStub.calls.length, 1)
      // Exactly one warning — the distinct, error-naming one — never both.
      assertEquals(warnStub.calls.length, 1)
      const message = String(warnStub.calls[0].args[0])
      assertStringIncludes(message, 'Permission denied (os error 13)')
      assertEquals(message.includes('It seems pre-commit is not installed.'), false)
    } finally {
      commandStub.restore()
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

// Covers the non-`Error` rejection fallback (`String(error)`) — Deno's own spawn failures are
// always real `Error`s in practice, but the message-building code has no other way to guarantee
// that for an arbitrary rejection.
Deno.test(
  'createPreCommitYaml still warns (without throwing) when the spawn rejects with a non-Error value',
  async () => {
    const root = `${temporaryFolder}/${crypto.randomUUID()}`
    await Deno.mkdir(root, { recursive: true })

    const commandStub = stub(
      Deno,
      'Command',
      () => ({ output: () => Promise.reject('boom') }) as never,
    )
    const warnStub = stub(logger, 'warn')

    try {
      const created = await createPreCommitYaml({ baseRoot: root })

      assert(created)
      assertEquals(warnStub.calls.length, 1)
      assertStringIncludes(String(warnStub.calls[0].args[0]), 'boom')
    } finally {
      commandStub.restore()
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
