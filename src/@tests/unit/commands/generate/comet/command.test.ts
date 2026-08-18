import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateCometAction, { registerCometCommand } from 'commands/generate/comet/command.ts'
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
  'generateCometAction should throw outside a space/space-server project',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateCometAction.call(new Commander(), {}, 'counter'),
        Error,
        "must be run inside a 'space' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateCometAction should write a real, correctly-shaped comet file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateCometAction.call(new Commander(), {}, 'ProductCounter')

    const cometPath = `${projectFolder}/src/space/comets/product-counter.comet.tsx`
    const content = await Deno.readTextFile(cometPath)

    assertEquals(content.startsWith("'use comet'"), true)
    assertEquals(content.includes('export function ProductCounter()'), true)
    assertEquals(
      content.includes(
        'export default defineComet(ProductCounter, import.meta.url)',
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

Deno.test('generateCometAction should work inside a space-server project too', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateCometAction.call(new Commander(), {}, 'counter')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/space/comets/counter.comet.tsx`,
    )
    assertEquals(content.includes('export function Counter()'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateCometAction should never overwrite an existing comet', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const cometsFolder = `${projectFolder}/src/space/comets`
  const cometPath = `${cometsFolder}/counter.comet.tsx`

  try {
    await Deno.mkdir(cometsFolder, { recursive: true })
    await Deno.writeTextFile(cometPath, '// customized by hand\n')

    await generateCometAction.call(new Commander(), {}, 'counter')

    assertEquals(await Deno.readTextFile(cometPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerCometCommand should wire the real actionHandler to generateCometAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerCometCommand(cwd)
    type ActionCommand = { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.actionHandler({}, 'WiredCounter')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/comets/wired-counter.comet.tsx`,
      )
      assertEquals(content.includes('export function WiredCounter()'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateCometAction should run deno check against the project when --verify is passed',
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
      await generateCometAction.call(new Commander(), { verify: true }, 'counter')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
