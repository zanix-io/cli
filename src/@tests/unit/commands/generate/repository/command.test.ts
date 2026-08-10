import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateRepositoryAction, { planRepository } from 'commands/generate/repository/command.ts'
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
  'generateRepositoryAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateRepositoryAction.call(new Commander(), {}, 'payment'),
        Error,
        "must be run inside a 'server' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateRepositoryAction should write provider and model files', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRepositoryAction.call(new Commander(), {}, 'PaymentMethod')

    const repoFolder = `${projectFolder}/src/server/repositories/payment-method`
    const provider = await Deno.readTextFile(`${repoFolder}/entity.provider.ts`)
    const model = await Deno.readTextFile(`${repoFolder}/model.defs.ts`)

    assertEquals(provider.includes('export class PaymentMethodRepository'), true)
    assertEquals(
      provider.includes("this.database.getModel<PaymentMethodAttrs>('payment-method')"),
      true,
    )
    assertEquals(
      provider.includes("import type { PaymentMethodAttrs } from './model.defs.ts'"),
      true,
    )
    assertEquals(model.includes('export type PaymentMethodAttrs'), true)
    assertEquals(model.includes("name: 'payment-method'"), true)

    const config = JSON.parse(await Deno.readTextFile(`${projectFolder}/deno.jsonc`))
    assertEquals(config.imports['@zanix/server'], ZANIX_DEPENDENCY_VERSIONS['@zanix/server'])
    assertEquals(
      config.imports['@zanix/datamaster'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRepositoryAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRepositoryAction.call(new Commander(), {}, 'invoice')
    await generateRepositoryAction.call(new Commander(), {}, 'invoice')

    const provider = await Deno.readTextFile(
      `${projectFolder}/src/server/repositories/invoice/entity.provider.ts`,
    )
    assertEquals(provider.includes('export class InvoiceRepository'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRepositoryAction should never overwrite an existing provider file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const repoFolder = `${projectFolder}/src/server/repositories/invoice`
  const providerPath = `${repoFolder}/entity.provider.ts`

  try {
    await Deno.mkdir(repoFolder, { recursive: true })
    await Deno.writeTextFile(providerPath, '// customized by hand\n')

    await generateRepositoryAction.call(new Commander(), {}, 'invoice')

    assertEquals(await Deno.readTextFile(providerPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planRepository returns entity.provider.ts + model.defs.ts', () => {
  const { files } = planRepository('example', 'Example', '/root/src/server/repositories/example')

  assertEquals(files.map((f) => f.NAME), ['entity.provider.ts', 'model.defs.ts'])
})
