import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateInteractorAction, { planInteractor } from 'commands/generate/interactor/command.ts'
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

Deno.test(
  'generateInteractorAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateInteractorAction.call(new Commander(), {}, 'payment'),
        Error,
        "must be run inside a 'server' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateInteractorAction should write an interactor file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateInteractorAction.call(new Commander(), {}, 'PaymentMethod')

    const interactorPath = `${projectFolder}/src/server/interactors/payment-method.interactor.ts`
    const content = await Deno.readTextFile(interactorPath)

    assertEquals(content.includes('export class PaymentMethodService'), true)
    assertEquals(content.includes('@Interactor()'), true)
    assertEquals(content.includes('extends ZanixInteractor'), true)

    const config = JSON.parse(await Deno.readTextFile(`${projectFolder}/deno.jsonc`))
    assertEquals(config.imports['@zanix/server'], ZANIX_DEPENDENCY_VERSIONS['@zanix/server'])
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateInteractorAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateInteractorAction.call(new Commander(), {}, 'invoice')
    await generateInteractorAction.call(new Commander(), {}, 'invoice')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/interactors/invoice.interactor.ts`,
    )
    assertEquals(content.includes('export class InvoiceService'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateInteractorAction should never overwrite an existing interactor', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const interactorsFolder = `${projectFolder}/src/server/interactors`
  const interactorPath = `${interactorsFolder}/invoice.interactor.ts`

  try {
    await Deno.mkdir(interactorsFolder, { recursive: true })
    await Deno.writeTextFile(interactorPath, '// customized by hand\n')

    await generateInteractorAction.call(new Commander(), {}, 'invoice')

    assertEquals(await Deno.readTextFile(interactorPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planInteractor returns a single <name>.interactor.ts', () => {
  const { files } = planInteractor('example', 'Example', '/root/src/server/interactors')

  assertEquals(files.map((f) => f.NAME), ['example.interactor.ts'])
})
