import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generatePageAction from 'commands/generate/page/command.ts'
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

    assertEquals(content.includes("import { Page, SpacePageController } from '@zanix/space'"), true)
    assertEquals(content.includes('@Page()'), true)
    assertEquals(
      content.includes('export default class ProductsPage extends SpacePageController'),
      true,
    )
    assertEquals(content.includes('component = ProductsView'), true)

    const config = JSON.parse(await Deno.readTextFile(`${projectFolder}/deno.jsonc`))
    assertEquals(config.imports['@zanix/space'], ZANIX_DEPENDENCY_VERSIONS['@zanix/space'])
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
        content.includes('export default class IdPage extends SpacePageController'),
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
