import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateInteractorAction, {
  planInteractor,
  registerInteractorCommand,
  resolveInteractorsFolder,
} from 'commands/generate/interactor/command.ts'
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
  'generateInteractorAction should throw outside a server/space-server/space project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateInteractorAction.call(new Commander(), {}, 'payment'),
        Error,
        "must be run inside a 'server' or 'space-server' or 'space' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateInteractorAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateInteractorAction.call(new Commander(), {}, '../../../../victim'),
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
  'generateInteractorAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateInteractorAction.call(new Commander(), {}, '123entity'),
        Error,
        "isn't a valid TypeScript identifier",
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

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/server'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
    )
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

    assertEquals(
      await Deno.readTextFile(interactorPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planInteractor returns a single <name>.interactor.ts', () => {
  const { files } = planInteractor(
    'example',
    'Example',
    '/root/src/server/interactors',
  )

  assertEquals(files.map((f) => f.NAME), ['example.interactor.ts'])
})

Deno.test(
  'generateInteractorAction should write a per-domain interactor in a space project',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateInteractorAction.call(new Commander(), {}, 'Triggers')

      const interactorPath = `${projectFolder}/src/triggers/triggers.interactor.ts`
      const content = await Deno.readTextFile(interactorPath)

      assertEquals(content.includes('export class TriggersService'), true)
      assertEquals(content.includes('@Interactor()'), true)
      assertEquals(content.includes('extends ZanixInteractor'), true)

      const config = JSON.parse(
        await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
      )
      assertEquals(
        config.imports['@zanix/server'],
        ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('resolveInteractorsFolder returns the shared interactors/ folder for server', () => {
  assertEquals(
    resolveInteractorsFolder('/root', 'server', 'triggers'),
    '/root/src/server/interactors',
  )
})

Deno.test(
  'resolveInteractorsFolder returns the shared interactors/ folder for space-server',
  () => {
    assertEquals(
      resolveInteractorsFolder('/root', 'space-server', 'triggers'),
      '/root/src/server/interactors',
    )
  },
)

Deno.test('resolveInteractorsFolder returns a per-domain folder for space', () => {
  assertEquals(
    resolveInteractorsFolder('/root', 'space', 'triggers'),
    '/root/src/triggers',
  )
})

Deno.test(
  'resolveInteractorsFolder falls back to the shared folder for an undefined project type',
  () => {
    assertEquals(
      resolveInteractorsFolder('/root', undefined, 'triggers'),
      '/root/src/server/interactors',
    )
  },
)

Deno.test(
  'registerInteractorCommand should wire the real actionHandler to generateInteractorAction',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerInteractorCommand(cwd)
    type ActionCommand = {
      settings: { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.settings.actionHandler({}, 'WiredService')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/server/interactors/wired-service.interactor.ts`,
      )
      assertEquals(content.includes('export class WiredServiceService'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateInteractorAction should run deno check against the project when --verify is passed',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    // `--verify` shells out to a real `deno check` via `verifyGeneratedProject` — stubbed here so
    // this test never depends on a real network resolution of the generated file's own imports.
    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({ output: () => Promise.resolve({ success: true, stderr: new Uint8Array() }) }) as never,
    )

    try {
      await generateInteractorAction.call(new Commander(), { verify: true }, 'payment')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
