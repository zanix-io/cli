import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateJobAction, { planJob } from 'commands/generate/job/command.ts'
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

Deno.test('generateJobAction should throw outside a server/space-server project', async () => {
  const projectFolder = await makeProject('library')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateJobAction.call(new Commander(), {}, 'payment-sync'),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateJobAction without --cron writes a queue-consumed registerJob', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateJobAction.call(new Commander(), {}, 'PaymentSync')

    const jobPath = `${projectFolder}/src/server/jobs/payment-sync.defs.ts`
    const content = await Deno.readTextFile(jobPath)

    assertEquals(
      content.includes("import { registerJob } from '@zanix/asyncmq'"),
      true,
    )
    assertEquals(content.includes("name: 'payment-sync'"), true)
    assertEquals(content.includes('registerCronJob'), false)
    assertEquals(content.includes('schedule:'), false)

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/asyncmq'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateJobAction with --cron writes a schedule-driven registerCronJob', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateJobAction.call(
      new Commander(),
      { cron: '0 */1 * * * *' },
      'PaymentSync',
    )

    const jobPath = `${projectFolder}/src/server/jobs/payment-sync.defs.ts`
    const content = await Deno.readTextFile(jobPath)

    assertEquals(
      content.includes("import { registerCronJob } from '@zanix/asyncmq'"),
      true,
    )
    assertEquals(content.includes("schedule: '0 */1 * * * *'"), true)
    assertEquals(content.includes('isActive: true'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateJobAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateJobAction.call(new Commander(), {}, 'invoice-sync')
    await generateJobAction.call(new Commander(), {}, 'invoice-sync')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/jobs/invoice-sync.defs.ts`,
    )
    assertEquals(content.includes("name: 'invoice-sync'"), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateJobAction should never overwrite an already-pinned @zanix/asyncmq version',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      const configPath = `${projectFolder}/deno.jsonc`
      const config = JSON.parse(await Deno.readTextFile(configPath))
      config.imports = { '@zanix/asyncmq': 'jsr:@zanix/asyncmq@0.1.0' }
      await Deno.writeTextFile(configPath, JSON.stringify(config))

      await generateJobAction.call(new Commander(), {}, 'invoice-sync')

      const updated = JSON.parse(await Deno.readTextFile(configPath))
      assertEquals(
        updated.imports['@zanix/asyncmq'],
        'jsr:@zanix/asyncmq@0.1.0',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateJobAction should never overwrite an existing job file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const jobsFolder = `${projectFolder}/src/server/jobs`
  const jobPath = `${jobsFolder}/invoice-sync.defs.ts`

  try {
    await Deno.mkdir(jobsFolder, { recursive: true })
    await Deno.writeTextFile(jobPath, '// customized by hand\n')

    await generateJobAction.call(new Commander(), {}, 'invoice-sync')

    assertEquals(await Deno.readTextFile(jobPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planJob returns a single <name>.defs.ts', () => {
  const { files } = planJob(
    'example-job',
    '0 0 * * * *',
    '/root/src/server/jobs',
  )

  assertEquals(files.map((f) => f.NAME), ['example-job.defs.ts'])
})
