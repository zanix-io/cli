import type { Editors } from '@zanix/types'
import type { Command } from '@cliffy/command'

import { createVSCodeConfig } from '@zanix/helpers'

function prepareEditorAction(this: Command, options: { editor?: unknown }) {
  const editor = options.editor || 'vscode' as Editors

  switch (editor) {
    case 'vscode':
      return createVSCodeConfig().catch((e) => this.throw(e))
    default:
      this.throw(
        new Error(`Invalid editor '${editor}' using cli command. Allowed values are: 'vscode'`),
      )
  }
}

export default prepareEditorAction
