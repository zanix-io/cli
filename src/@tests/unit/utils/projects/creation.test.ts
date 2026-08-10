import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { createFilesAndFolders, ensureConstant } from 'utils/projects/creation.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('createFilesAndFolders should skip template files with a falsy PATH', async () => {
  let contentCalls = 0

  await createFilesAndFolders(
    {
      templates: {
        base: [
          {
            PATH: '',
            NAME: 'skipped',
            content: () => {
              contentCalls++
              return Promise.resolve('')
            },
          },
        ],
      },
    },
    'base',
  )

  assertEquals(contentCalls, 0)
})

Deno.test('createFilesAndFolders should resolve only after every write completes', async () => {
  const filePath = `${temporaryFolder}/awaited.txt`

  await createFilesAndFolders(
    {
      FOLDER: temporaryFolder,
      templates: {
        base: [
          { PATH: filePath, NAME: 'awaited.txt', content: () => Promise.resolve('done') },
        ],
      },
    },
    'base',
  )

  assert(await Deno.readTextFile(filePath).then(() => true).catch(() => false))
  assertEquals(await Deno.readTextFile(filePath), 'done')

  await Deno.remove(filePath)
})

Deno.test('ensureConstant should create the file+folder when neither exists yet', async () => {
  const filePath = `${temporaryFolder}/ensure-constant-new/constants.ts`

  await ensureConstant(filePath, 'OBJECTID_REGEX', 'export const OBJECTID_REGEX = /a/')

  assertEquals(await Deno.readTextFile(filePath), 'export const OBJECTID_REGEX = /a/\n')

  await Deno.remove(`${temporaryFolder}/ensure-constant-new`, { recursive: true })
})

Deno.test('ensureConstant should append the declaration when the file lacks it', async () => {
  const filePath = `${temporaryFolder}/ensure-constant-append.ts`
  await Deno.writeTextFile(filePath, "export const OTHER = 'x'\n")

  await ensureConstant(filePath, 'OBJECTID_REGEX', 'export const OBJECTID_REGEX = /a/')

  assertEquals(
    await Deno.readTextFile(filePath),
    "export const OTHER = 'x'\nexport const OBJECTID_REGEX = /a/\n",
  )

  await Deno.remove(filePath)
})

Deno.test({
  name: 'ensureConstant should add a newline before appending if the file lacks one',
  fn: async () => {
    const filePath = `${temporaryFolder}/ensure-constant-no-trailing-newline.ts`
    await Deno.writeTextFile(filePath, "export const OTHER = 'x'")

    await ensureConstant(filePath, 'OBJECTID_REGEX', 'export const OBJECTID_REGEX = /a/')

    assertEquals(
      await Deno.readTextFile(filePath),
      "export const OTHER = 'x'\nexport const OBJECTID_REGEX = /a/\n",
    )

    await Deno.remove(filePath)
  },
})

Deno.test('ensureConstant should never duplicate a declaration already present', async () => {
  const filePath = `${temporaryFolder}/ensure-constant-existing.ts`
  const original = 'export const OBJECTID_REGEX = /already-here/\n'
  await Deno.writeTextFile(filePath, original)

  await ensureConstant(filePath, 'OBJECTID_REGEX', 'export const OBJECTID_REGEX = /a/')

  assertEquals(await Deno.readTextFile(filePath), original)

  await Deno.remove(filePath)
})
