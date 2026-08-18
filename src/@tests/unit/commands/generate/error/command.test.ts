import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateErrorAction, { registerErrorCommand } from 'commands/generate/error/command.ts'
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

Deno.test('generateErrorAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateErrorAction.call(new Commander(), {}, 'products'),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateErrorAction should write a real, correctly-shaped error file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateErrorAction.call(new Commander(), {}, 'products')

    const errorPath = `${projectFolder}/src/space/routes/products/error.tsx`
    const content = await Deno.readTextFile(errorPath)

    assertEquals(
      content.includes("import type { ErrorBoundaryProps } from '@zanix/space'"),
      true,
    )
    assertEquals(
      content.includes(
        'export default function ProductsError({ error, reset }: ErrorBoundaryProps)',
      ),
      true,
    )

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

Deno.test('generateErrorAction should work at the root route path too', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateErrorAction.call(new Commander(), {}, '')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/space/routes/error.tsx`,
    )
    assertEquals(content.includes('export default function IndexError'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateErrorAction should never overwrite an existing error boundary', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const routeFolder = `${projectFolder}/src/space/routes/products`
  const errorPath = `${routeFolder}/error.tsx`

  try {
    await Deno.mkdir(routeFolder, { recursive: true })
    await Deno.writeTextFile(errorPath, '// customized by hand\n')

    await generateErrorAction.call(new Commander(), {}, 'products')

    assertEquals(
      await Deno.readTextFile(errorPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerErrorCommand should wire the real actionHandler to generateErrorAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerErrorCommand(cwd)
    type ActionCommand = { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.actionHandler({}, 'wired')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/wired/error.tsx`,
      )
      assertEquals(content.includes('export default function WiredError'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateErrorAction should run deno check against the project when --verify is passed',
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
      await generateErrorAction.call(new Commander(), { verify: true }, 'products')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
