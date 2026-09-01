import { assert, assertStringIncludes } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import prepareEditorAction from 'commands/prepare/actions/editor.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

console.error = () => {}

Deno.test('prepareEditorAction should throw for an unsupported editor', () => {
  let thrown: Error | undefined

  const fakeCommander = {
    throw: (e: Error) => {
      thrown = e
    },
  }

  prepareEditorAction.call(fakeCommander as never, { editor: 'sublime' })

  assert(thrown?.message.includes("Invalid editor 'sublime'"))
})

Deno.test(
  'prepareEditorAction routes a genuine createEditorFileConfig write failure through this.throw, not exit 0',
  async () => {
    // Locks in the swallow→re-throw fix in `commands/prepare/lib/editor/main.ts`'s own
    // `createEditorFileConfig`: `root` itself is a blocker FILE (not a directory), so the real
    // `Deno.mkdir(baseFolder, { recursive: true })` inside `createEditorFileConfig`
    // (`baseFolder = join(root, EDITORS.vscode.FOLDER)`) fails for real — not the benign "merge
    // with existing settings" branch. Before the fix, that failure was swallowed into `return
    // false`, which nothing here checked, and the action exited 0 regardless — mirrors
    // `docker.test.ts`'s identical "blocker file" regression test for `prepareDockerAction`.
    const blockerFile = `${temporaryFolder}/blocker-${crypto.randomUUID()}`
    await Deno.writeTextFile(blockerFile, '')

    let thrown: unknown
    // deno-lint-ignore no-explicit-any
    const fakeCommander: { throw: (e: any) => void } = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await prepareEditorAction.call(fakeCommander as never, { editor: 'vscode' }, blockerFile)

      assert(thrown, 'expected this.throw to have been called')
      assertStringIncludes((thrown as Error).message, 'mkdir')
    } finally {
      await Deno.remove(blockerFile)
    }
  },
)
