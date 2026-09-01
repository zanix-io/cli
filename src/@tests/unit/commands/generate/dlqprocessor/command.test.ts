import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateDlqProcessorAction, {
  planDlqProcessor,
} from 'commands/generate/dlqprocessor/command.ts'
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
  'generateDlqProcessorAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateDlqProcessorAction.call(
            new Commander(),
            { processType: 'payment.process', schedule: '0,30 * * * * *' },
            'payment-retry',
          ),
        Error,
        "must be run inside a 'server' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateDlqProcessorAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateDlqProcessorAction.call(
            new Commander(),
            { processType: 'payment.process', schedule: '0,30 * * * * *' },
            '../../../../victim',
          ),
        Error,
        'path-traversal segment',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateDlqProcessorAction should throw a clear error when --process-type is missing',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateDlqProcessorAction.call(
            new Commander(),
            { schedule: '0,30 * * * * *' },
            'payment-retry',
          ),
        Error,
        'needs a --process-type',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateDlqProcessorAction should throw a clear error when --schedule is missing',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateDlqProcessorAction.call(
            new Commander(),
            { processType: 'payment.process' },
            'payment-retry',
          ),
        Error,
        'needs a --schedule',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateDlqProcessorAction writes the processor + the shared DLQ model file',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateDlqProcessorAction.call(
        new Commander(),
        { processType: 'payment.process', schedule: '0,30 * * * * *' },
        'PaymentRetry',
      )

      const processor = await Deno.readTextFile(
        `${projectFolder}/src/server/dlq/payment-retry.defs.ts`,
      )
      assertEquals(
        processor.includes(
          "import { registerDLQProcessor } from '@zanix/asyncmq/dlq'",
        ),
        true,
      )
      assertEquals(
        processor.includes("registerDLQProcessor('payment.process'"),
        true,
      )
      assertEquals(processor.includes("name: 'payment-retry'"), true)
      assertEquals(processor.includes("schedule: '0,30 * * * * *'"), true)

      const model = await Deno.readTextFile(
        `${projectFolder}/src/server/repositories/dlq.defs.ts`,
      )
      assertEquals(
        model.includes("import { registerDLQModel } from '@zanix/datamaster'"),
        true,
      )
      assertEquals(model.includes('registerDLQModel()'), true)

      const config = JSON.parse(
        await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
      )
      assertEquals(
        config.imports['@zanix/asyncmq'],
        ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq'],
      )
      assertEquals(
        config.imports['@zanix/datamaster'],
        ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'],
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateDlqProcessorAction should never overwrite an existing DLQ model file',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const repositoriesFolder = `${projectFolder}/src/server/repositories`
    const modelPath = `${repositoriesFolder}/dlq.defs.ts`

    try {
      await Deno.mkdir(repositoriesFolder, { recursive: true })
      await Deno.writeTextFile(modelPath, '// customized by hand\n')

      await generateDlqProcessorAction.call(
        new Commander(),
        { processType: 'payment.process', schedule: '0,30 * * * * *' },
        'payment-retry',
      )

      assertEquals(
        await Deno.readTextFile(modelPath),
        '// customized by hand\n',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateDlqProcessorAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    const options = {
      processType: 'payment.process',
      schedule: '0,30 * * * * *',
    }
    await generateDlqProcessorAction.call(
      new Commander(),
      options,
      'payment-retry',
    )
    await generateDlqProcessorAction.call(
      new Commander(),
      options,
      'payment-retry',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/dlq/payment-retry.defs.ts`,
    )
    assertEquals(content.includes("name: 'payment-retry'"), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateDlqProcessorAction escapes a single quote in the name, --process-type, and --schedule',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateDlqProcessorAction.call(
        new Commander(),
        {
          processType: "payment.process'; console.log('pwned'); //",
          schedule: "0,30 * * * * *'; console.log('pwned'); //",
        },
        "O'Brien Retry",
      )

      const content = await Deno.readTextFile(
        `${projectFolder}/src/server/dlq/o'brien-retry.defs.ts`,
      )

      assertEquals(content.includes("name: 'o\\'brien-retry'"), true)
      assertEquals(
        content.includes(
          "registerDLQProcessor('payment.process\\'; console.log(\\'pwned\\'); //'",
        ),
        true,
      )
      assertEquals(
        content.includes(
          "schedule: '0,30 * * * * *\\'; console.log(\\'pwned\\'); //'",
        ),
        true,
      )
      // None of the raw, unescaped payloads survive — each would break its own literal apart.
      assertEquals(content.includes("name: 'o'brien-retry'"), false)
      assertEquals(
        content.includes("registerDLQProcessor('payment.process'; console.log"),
        false,
      )
      assertEquals(
        content.includes("schedule: '0,30 * * * * *'; console.log"),
        false,
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('planDlqProcessor returns the processor file + the shared model file', () => {
  const { files } = planDlqProcessor(
    'payment-retry',
    'payment.process',
    '0,30 * * * * *',
    '/root/src/server/dlq',
    '/root/src/server/repositories',
  )

  assertEquals(files.map((f) => f.NAME), [
    'payment-retry.defs.ts',
    'dlq.defs.ts',
  ])
})

Deno.test('planDlqProcessor throws when --process-type is missing', () => {
  assertThrows(
    () =>
      planDlqProcessor(
        'payment-retry',
        undefined,
        '0,30 * * * * *',
        '/root/src/server/dlq',
        '/root/src/server/repositories',
      ),
    Error,
    'needs a --process-type',
  )
})

Deno.test('planDlqProcessor throws when --schedule is missing', () => {
  assertThrows(
    () =>
      planDlqProcessor(
        'payment-retry',
        'payment.process',
        undefined,
        '/root/src/server/dlq',
        '/root/src/server/repositories',
      ),
    Error,
    'needs a --schedule',
  )
})
