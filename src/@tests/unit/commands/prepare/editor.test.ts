import { assert } from '@std/assert'
import prepareEditorAction from 'commands/prepare/actions/editor.ts'

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
