import type { Editors } from '@zanix/types'
import type { Commander } from 'cli'

import { createVSCodeConfig } from '@zanix/helpers'

function prepareEditorAction(this: Commander, options: { editor?: unknown }, root?: string) {
  const editor = options.editor || 'vscode' as Editors

  switch (editor) {
    case 'vscode':
      return createVSCodeConfig({ baseRoot: root }).catch((e) => this.throw(e))
    default:
      this.throw(
        new Error(`Invalid editor '${editor}' using cli command. Allowed values are: 'vscode'`),
      )
  }
}

export default prepareEditorAction
