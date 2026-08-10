import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateRtoAction, { planRto } from 'commands/generate/rto/command.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(zanixProject: string): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({ zanix: { project: zanixProject } }),
  )
  return projectFolder
}

Deno.test('generateRtoAction should throw outside a server/space-server project', async () => {
  const projectFolder = await makeProject('library')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateRtoAction.call(new Commander(), { field: ['name:string'] }, 'payment'),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction should throw a clear error when no --field is given', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateRtoAction.call(new Commander(), {}, 'payment'),
      Error,
      'needs at least one --field',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction writes RTO+IsObjectID.ts, skips IsPermission.ts', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRtoAction.call(
      new Commander(),
      { field: ['amount:number', 'currencyId:objectId'] },
      'PaymentMethod',
    )

    const rtosFolder = `${projectFolder}/src/server/handlers/rtos`
    const rto = await Deno.readTextFile(`${rtosFolder}/payment-method.rto.ts`)
    assert(rto.includes('export class PaymentMethodRTO'))
    assert(rto.includes('accessor amount!: number'))

    const isObjectId = await Deno.readTextFile(`${rtosFolder}/validations/IsObjectID.ts`)
    assert(isObjectId.includes('export const IsObjectID'))

    await assertRejects(() => Deno.stat(`${rtosFolder}/validations/IsPermission.ts`))

    const constants = await Deno.readTextFile(`${projectFolder}/src/utils/constants.ts`)
    assertEquals(constants, 'export const OBJECTID_REGEX = /^[0-9a-fA-F]{24}$/\n')

    const config = JSON.parse(await Deno.readTextFile(`${projectFolder}/deno.jsonc`))
    assertEquals(config.imports['@zanix/validator'], ZANIX_DEPENDENCY_VERSIONS['@zanix/validator'])
    assertEquals(
      config.imports['@zanix/datamaster'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction writes IsPermission.ts+constant when needed', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRtoAction.call(
      new Commander(),
      { field: ['grantedBy:permission'] },
      'Role',
    )

    const validationsFolder = `${projectFolder}/src/server/handlers/rtos/validations`
    const isPermission = await Deno.readTextFile(`${validationsFolder}/IsPermission.ts`)
    assert(isPermission.includes('export const IsPermission'))

    const constants = await Deno.readTextFile(`${projectFolder}/src/utils/constants.ts`)
    assert(constants.includes('OBJECTID_REGEX'))
    assert(constants.includes('PERMISSION_REGEX'))
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction appends OBJECTID_REGEX to an existing constants.ts', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await Deno.mkdir(`${projectFolder}/src/utils`, { recursive: true })
    await Deno.writeTextFile(
      `${projectFolder}/src/utils/constants.ts`,
      "export const SOMETHING_ELSE = 'x'\n",
    )

    await generateRtoAction.call(new Commander(), { field: ['id:objectId'] }, 'Thing')

    const constants = await Deno.readTextFile(`${projectFolder}/src/utils/constants.ts`)
    assertEquals(
      constants,
      "export const SOMETHING_ELSE = 'x'\nexport const OBJECTID_REGEX = /^[0-9a-fA-F]{24}$/\n",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRtoAction.call(new Commander(), { field: ['name:string'] }, 'invoice')
    await generateRtoAction.call(new Commander(), { field: ['name:string'] }, 'invoice')

    const rto = await Deno.readTextFile(
      `${projectFolder}/src/server/handlers/rtos/invoice.rto.ts`,
    )
    assert(rto.includes('export class InvoiceRTO'))
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction should never overwrite an existing RTO file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const rtosFolder = `${projectFolder}/src/server/handlers/rtos`
  const rtoPath = `${rtosFolder}/invoice.rto.ts`

  try {
    await Deno.mkdir(rtosFolder, { recursive: true })
    await Deno.writeTextFile(rtoPath, '// customized by hand\n')

    await generateRtoAction.call(new Commander(), { field: ['name:string'] }, 'invoice')

    assertEquals(await Deno.readTextFile(rtoPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planRto without a permission field returns rto.ts+IsObjectID.ts only', () => {
  const { files } = planRto('example', 'Example', [], '/root/src/server/handlers/rtos')

  assertEquals(files.map((f) => f.NAME), ['example.rto.ts', 'IsObjectID.ts'])
})

Deno.test('planRto with a permission field also returns IsPermission.ts', () => {
  const { files } = planRto(
    'role',
    'Role',
    [{ name: 'grantedBy', type: 'permission', optional: false, isArray: false }],
    '/root/src/server/handlers/rtos',
  )

  assertEquals(files.map((f) => f.NAME), ['role.rto.ts', 'IsObjectID.ts', 'IsPermission.ts'])
})

Deno.test(
  'planRto.ensureConstants writes only OBJECTID_REGEX when no permission field is used',
  async () => {
    const projectFolder = await makeProject('server')

    try {
      await planRto('example', 'Example', [], `${projectFolder}/src/server/handlers/rtos`)
        .ensureConstants(projectFolder)

      const constants = await Deno.readTextFile(`${projectFolder}/src/utils/constants.ts`)
      assert(constants.includes('OBJECTID_REGEX'))
      assert(!constants.includes('PERMISSION_REGEX'))
    } finally {
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  "getServerSrcTree's rto leaf uses planRto, so IsObjectID.ts is never left dangling",
  async () => {
    const { getServerSrcTree } = await import('commands/new/lib/tree/projects/server.ts')
    const tree = getServerSrcTree(`${temporaryFolder}/${crypto.randomUUID()}`)
    const rtoFiles = tree.subfolders.handlers.subfolders.rtos.templates.base

    assertEquals(rtoFiles.map((f) => f.NAME), ['example.rto.ts', 'IsObjectID.ts'])
  },
)
