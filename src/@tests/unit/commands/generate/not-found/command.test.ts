import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateNotFoundAction, {
  registerNotFoundCommand,
} from 'commands/generate/not-found/command.ts'
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

Deno.test('generateNotFoundAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateNotFoundAction.call(new Commander(), {}),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateNotFoundAction writes a real, correctly-shaped not-found file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateNotFoundAction.call(new Commander(), {})

    const notFoundPath = `${projectFolder}/src/space/routes/not-found.tsx`
    const content = await Deno.readTextFile(notFoundPath)

    assertEquals(content.includes('export default function NotFound()'), true)
    assertEquals(content.includes('Page not found'), true)

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/space'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateNotFoundAction should never overwrite an existing not-found file', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const routesFolder = `${projectFolder}/src/space/routes`
  const notFoundPath = `${routesFolder}/not-found.tsx`

  try {
    await Deno.mkdir(routesFolder, { recursive: true })
    await Deno.writeTextFile(notFoundPath, '// customized by hand\n')

    await generateNotFoundAction.call(new Commander(), {})

    assertEquals(
      await Deno.readTextFile(notFoundPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerNotFoundCommand should wire the real actionHandler to generateNotFoundAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerNotFoundCommand(cwd)
    type ActionCommand = { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.actionHandler({})

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/not-found.tsx`,
      )
      assertEquals(content.includes('export default function NotFound()'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateNotFoundAction should run deno check against the project when --verify is passed',
  async () => {
    const projectFolder = await makeProject('space')
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
      await generateNotFoundAction.call(new Commander(), { verify: true })

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
