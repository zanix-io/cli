import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateComponentAction, {
  registerComponentCommand,
} from 'commands/generate/component/command.ts'
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
  'generateComponentAction should throw outside a space/space-server project',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateComponentAction.call(new Commander(), {}, 'product-card'),
        Error,
        "must be run inside a 'space' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateComponentAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateComponentAction.call(new Commander(), {}, '../../../../victim'),
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
  'generateComponentAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateComponentAction.call(new Commander(), {}, '123entity'),
        Error,
        "isn't a valid TypeScript identifier",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateComponentAction should reject a name that collapses to an empty identifier',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateComponentAction.call(new Commander(), {}, '---'),
        Error,
        "isn't a valid TypeScript identifier",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateComponentAction should write a real, correctly-shaped component file',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateComponentAction.call(new Commander(), {}, 'ProductCard')

      const componentPath = `${projectFolder}/src/space/components/product-card.tsx`
      const content = await Deno.readTextFile(componentPath)

      assertEquals(
        content,
        `export default function ProductCard() {
  return <div>ProductCard</div>
}
`,
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
  },
)

Deno.test('generateComponentAction should work inside a space-server project too', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateComponentAction.call(new Commander(), {}, 'card')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/space/components/card.tsx`,
    )
    assertEquals(content.includes('export default function Card()'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateComponentAction should never overwrite an existing component', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const componentsFolder = `${projectFolder}/src/space/components`
  const componentPath = `${componentsFolder}/card.tsx`

  try {
    await Deno.mkdir(componentsFolder, { recursive: true })
    await Deno.writeTextFile(componentPath, '// customized by hand\n')

    await generateComponentAction.call(new Commander(), {}, 'card')

    assertEquals(await Deno.readTextFile(componentPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerComponentCommand should wire the real actionHandler to generateComponentAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerComponentCommand(cwd)
    type ActionCommand = {
      settings: { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.settings.actionHandler({}, 'WiredCard')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/components/wired-card.tsx`,
      )
      assertEquals(content.includes('export default function WiredCard()'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateComponentAction should run deno check against the project when --verify is passed',
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
      await generateComponentAction.call(new Commander(), { verify: true }, 'card')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
