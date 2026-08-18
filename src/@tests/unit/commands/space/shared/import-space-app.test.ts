import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'

// deno-lint-ignore no-explicit-any
type FakeCommander = { throw: (e: any) => void }

const TMP_ROOT = getTemporaryFolder(import.meta.url)

// `command-renderer.test.ts` (under `space/build`) already covers the real, valid `space.app.ts`
// happy path through this same function. Neither error branch is exercised anywhere else.

Deno.test(
  'importSpaceApp should route a real import failure through cwd.throw',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    // Deliberately no `space.app.ts` written — the real `import()` below fails to resolve.
    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await importSpaceApp(fakeCommander as never, root).catch(() => {})

      assert(thrown, 'expected cwd.throw to have been called')
      assert((thrown as Error).message.includes("Could not import 'space.app.ts'"))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'importSpaceApp should route an invalid default export through cwd.throw',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      'export default { notAZanixAppDefinition: true }\n',
    )
    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await importSpaceApp(fakeCommander as never, root).catch(() => {})

      assert(thrown, 'expected cwd.throw to have been called')
      assertEquals(
        (thrown as Error).message.includes('must have a default export from defineSpaceApp()'),
        true,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
