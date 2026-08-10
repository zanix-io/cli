import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateSeederAction from 'commands/generate/seeder/command.ts'
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

Deno.test('generateSeederAction should throw outside a server/space-server project', async () => {
  const projectFolder = await makeProject('library')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateSeederAction.call(new Commander(), {}, 'payment'),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSeederAction should throw clearly when no config file exists', async () => {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateSeederAction.call(new Commander(), {}, 'payment'),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSeederAction should throw clearly for a malformed config file', async () => {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(`${projectFolder}/deno.jsonc`, '{ not valid json')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateSeederAction.call(new Commander(), {}, 'payment'),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSeederAction should write the seeder trio and the shared helper', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateSeederAction.call(new Commander(), {}, 'PaymentMethod')

    const seedersFolder = `${projectFolder}/src/server/repositories/payment-method/seeders`
    const main = await Deno.readTextFile(`${seedersFolder}/main.ts`)
    const dev = await Deno.readTextFile(`${seedersFolder}/seeders.dev.ts`)
    const prod = await Deno.readTextFile(`${seedersFolder}/seeders.prod.ts`)
    const helper = await Deno.readTextFile(`${projectFolder}/src/utils/seeders.ts`)

    assertEquals(main.includes("import { defineSeeders } from 'utils/seeders.ts'"), true)
    assertEquals(dev.trim(), 'export default []')
    assertEquals(prod.trim(), 'export default []')
    assertEquals(helper.includes('export const defineSeeders'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSeederAction should never overwrite an existing seeders helper', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const helperPath = `${projectFolder}/src/utils/seeders.ts`

  try {
    await Deno.mkdir(`${projectFolder}/src/utils`, { recursive: true })
    await Deno.writeTextFile(helperPath, '// customized by hand\n')

    await generateSeederAction.call(new Commander(), {}, 'invoice')

    assertEquals(await Deno.readTextFile(helperPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateSeederAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateSeederAction.call(new Commander(), {}, 'invoice')
    await generateSeederAction.call(new Commander(), {}, 'invoice')

    const main = await Deno.readTextFile(
      `${projectFolder}/src/server/repositories/invoice/seeders/main.ts`,
    )
    assertEquals(main.includes("import { defineSeeders } from 'utils/seeders.ts'"), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})
