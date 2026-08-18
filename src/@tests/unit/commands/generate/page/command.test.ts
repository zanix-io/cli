import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'
import generatePageAction, { registerPageCommand } from 'commands/generate/page/command.ts'
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

Deno.test('generatePageAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generatePageAction.call(new Commander(), {}, 'products'),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generatePageAction should write a real, correctly-shaped page file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generatePageAction.call(new Commander(), {}, 'products')

    const pagePath = `${projectFolder}/src/space/routes/products/page.tsx`
    const content = await Deno.readTextFile(pagePath)

    assertEquals(
      content.includes(
        "import { Page, SpacePageController } from '@zanix/space'",
      ),
      true,
    )
    assertEquals(content.includes('@Page()'), true)
    assertEquals(
      content.includes(
        'export default class ProductsPage extends SpacePageController',
      ),
      true,
    )
    assertEquals(content.includes('component = ProductsView'), true)

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

Deno.test(
  'generatePageAction should preserve a dynamic segment verbatim in the folder path, ' +
    'stripping brackets only for the derived class name',
  async () => {
    const projectFolder = await makeProject('space-server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generatePageAction.call(new Commander(), {}, 'products/[id]')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/products/[id]/page.tsx`,
      )
      assertEquals(
        content.includes(
          'export default class IdPage extends SpacePageController',
        ),
        true,
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generatePageAction should never overwrite an existing page', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const routeFolder = `${projectFolder}/src/space/routes/products`
  const pagePath = `${routeFolder}/page.tsx`

  try {
    await Deno.mkdir(routeFolder, { recursive: true })
    await Deno.writeTextFile(pagePath, '// customized by hand\n')

    await generatePageAction.call(new Commander(), {}, 'products')

    assertEquals(await Deno.readTextFile(pagePath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerPageCommand should wire the real actionHandler to generatePageAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerPageCommand(cwd)
    type ActionCommand = { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.actionHandler({}, 'wired')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/wired/page.tsx`,
      )
      assertEquals(
        content.includes('export default class WiredPage extends SpacePageController'),
        true,
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generatePageAction should run deno check against the project when --verify is passed',
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
      await generatePageAction.call(new Commander(), { verify: true }, 'products')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generatePageAction: the generated page declares a static head with a title — a document with no ' +
    "<title> is non-conforming (the HTML Standard's head content model requires exactly one) and " +
    'fails WCAG 2.4.2, and before this the default scaffold produced exactly that',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generatePageAction.call(new Commander(), {}, 'products')
      const source = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/products/page.tsx`,
      )
      assertStringIncludes(source, "static head = { title: 'Products' }")
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generatePageAction: the generated page renders an <h1> — a SCAFFOLDING CONVENTION only. ' +
    '@zanix/space does not require a document to have one: not an HTML requirement, not a WCAG ' +
    'success criterion, and Google Search documents no requirement about heading counts. This ' +
    'assertion locks in what the generator writes, never what the framework demands',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generatePageAction.call(new Commander(), {}, 'products')
      const source = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/products/page.tsx`,
      )
      assertStringIncludes(source, '<h1>Products</h1>')
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)
