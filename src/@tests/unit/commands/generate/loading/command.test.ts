import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateLoadingAction, { registerLoadingCommand } from 'commands/generate/loading/command.ts'
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

Deno.test('generateLoadingAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateLoadingAction.call(new Commander(), {}, 'products'),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateLoadingAction should reject a route path containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateLoadingAction.call(new Commander(), {}, '../../../../victim'),
        Error,
        'path-traversal segment',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateLoadingAction should write a real, correctly-shaped loading file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateLoadingAction.call(new Commander(), {}, 'products')

    const loadingPath = `${projectFolder}/src/space/routes/products/loading.tsx`
    const content = await Deno.readTextFile(loadingPath)

    assertEquals(
      content.includes('export default function ProductsLoading()'),
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

Deno.test('generateLoadingAction should work at the root route path too', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateLoadingAction.call(new Commander(), {}, '')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/space/routes/loading.tsx`,
    )
    assertEquals(content.includes('export default function IndexLoading'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLoadingAction should never overwrite an existing loading file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const routeFolder = `${projectFolder}/src/space/routes/products`
  const loadingPath = `${routeFolder}/loading.tsx`

  try {
    await Deno.mkdir(routeFolder, { recursive: true })
    await Deno.writeTextFile(loadingPath, '// customized by hand\n')

    await generateLoadingAction.call(new Commander(), {}, 'products')

    assertEquals(
      await Deno.readTextFile(loadingPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerLoadingCommand should wire the real actionHandler to generateLoadingAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerLoadingCommand(cwd)
    type ActionCommand = {
      settings: { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.settings.actionHandler({}, 'wired')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/wired/loading.tsx`,
      )
      assertEquals(content.includes('export default function WiredLoading'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateLoadingAction should run deno check against the project when --verify is passed',
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
      await generateLoadingAction.call(new Commander(), { verify: true }, 'products')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
