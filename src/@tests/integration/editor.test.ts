import { createVSCodeConfig } from 'commands/prepare/lib/editor/vscode.ts'
import { createEditorFileConfig } from 'commands/prepare/lib/editor/main.ts'
import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse } from '@std/assert'
import { editors } from 'commands/prepare/lib/constants.ts'
import { stub } from '@std/testing/mock'

const defaultFolder = getTemporaryFolder(import.meta.url) + '/editor'

// Disable console
stub(console, 'info')
stub(console, 'error')
stub(console, 'warn')

Deno.test('Editor config creation validation', async () => {
  const cwdMock = stub(Deno, 'cwd', () => '')

  const currentEditor = { ...editors.vscode }
  editors.vscode = { FOLDER: defaultFolder, FILENAME: 'settings' }

  const response = await createVSCodeConfig()

  const content = await Deno.readTextFile(defaultFolder + '/settings')
  assert(response)
  assert(content.includes('"deno.config": "deno.json'))
  await Deno.remove(defaultFolder, { recursive: true })

  editors.vscode = currentEditor

  cwdMock.restore()
})

Deno.test('Editor config creation merges with an already existing settings file', async () => {
  const cwdMock = stub(Deno, 'cwd', () => '')

  const currentEditor = { ...editors.vscode }
  editors.vscode = { FOLDER: defaultFolder, FILENAME: 'settings' }

  await createVSCodeConfig() // first call creates the file
  const response = await createVSCodeConfig() // second call must merge with the existing content

  const content = await Deno.readTextFile(defaultFolder + '/settings')
  assert(response)
  assert(content.includes('"deno.config": "deno.json'))
  await Deno.remove(defaultFolder, { recursive: true })

  editors.vscode = currentEditor

  cwdMock.restore()
})

Deno.test('Editor config creation returns false on an unknown editor type', async () => {
  const response = await createEditorFileConfig({ type: 'unknown-editor' as never })

  assertFalse(response)
})

Deno.test('Editor config creation falls back to the literal deno.json name', async () => {
  const emptyDir = getTemporaryFolder(import.meta.url) + '/empty-config'
  await Deno.mkdir(emptyDir, { recursive: true })
  const cwdMock = stub(Deno, 'cwd', () => emptyDir) // no deno.json/.jsonc here, so getConfigDir() returns null

  const currentEditor = { ...editors.vscode }
  editors.vscode = { FOLDER: 'settings-folder', FILENAME: 'settings' }

  try {
    const response = await createVSCodeConfig({ baseRoot: defaultFolder })

    const content = await Deno.readTextFile(defaultFolder + '/settings-folder/settings')
    assert(response)
    assert(content.includes('"deno.config": "deno.json"'))
  } finally {
    await Deno.remove(defaultFolder, { recursive: true })
    await Deno.remove(emptyDir, { recursive: true })
    editors.vscode = currentEditor
    cwdMock.restore()
  }
})

Deno.test('createEditorFileConfig defaults to the identity callback', async () => {
  const currentEditor = { ...editors.vscode }
  editors.vscode = { FOLDER: defaultFolder, FILENAME: 'settings' }

  try {
    const response = await createEditorFileConfig({ type: 'vscode', baseRoot: '' })

    assert(response)
    const content = await Deno.readTextFile(defaultFolder + '/settings')
    assert(content.includes('$DENO_CONFIG')) // left untouched by the default identity callback
  } finally {
    await Deno.remove(defaultFolder, { recursive: true })
    editors.vscode = currentEditor
  }
})
