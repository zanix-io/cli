import type { Editors } from 'commands/prepare/lib/typings.ts'
import type { Commander } from 'cli'

import { createVSCodeConfig } from 'commands/prepare/lib/editor/vscode.ts'

/** `zanix prepare -e/--editor`'s real orchestration — `'vscode'` is the only supported value
 * today (also the default when the flag is passed with no explicit value); anything else throws
 * through `this.throw`. */
function prepareEditorAction(
  this: Commander,
  options: { editor?: unknown },
  root?: string,
) {
  const editor = options.editor || 'vscode' as Editors

  switch (editor) {
    case 'vscode':
      // A real write failure rejects instead of resolving `false` (see `createEditorFileConfig`'s
      // own doc), so `.catch` alone is enough to route it to a non-zero exit code.
      return createVSCodeConfig({ baseRoot: root }).catch((e) => this.throw(e))
    default:
      this.throw(
        new Error(
          `Invalid editor '${editor}' using cli command. Allowed values are: 'vscode'`,
        ),
      )
  }
}

export default prepareEditorAction
