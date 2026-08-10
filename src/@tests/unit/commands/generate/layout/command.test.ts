import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateLayoutAction from 'commands/generate/layout/command.ts'
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

Deno.test('generateLayoutAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateLayoutAction.call(new Commander(), {}, 'products'),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLayoutAction should write a real, correctly-shaped layout file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateLayoutAction.call(new Commander(), {}, 'products')

    const layoutPath = `${projectFolder}/src/space/routes/products/layout.tsx`
    const content = await Deno.readTextFile(layoutPath)

    assertEquals(content.includes("import type { LayoutProps } from '@zanix/space'"), true)
    assertEquals(
      content.includes('export default function ProductsLayout({ children }: LayoutProps)'),
      true,
    )

    const config = JSON.parse(await Deno.readTextFile(`${projectFolder}/deno.jsonc`))
    assertEquals(config.imports['@zanix/space'], ZANIX_DEPENDENCY_VERSIONS['@zanix/space'])
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLayoutAction should work at the root route path too', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateLayoutAction.call(new Commander(), {}, '')

    const content = await Deno.readTextFile(`${projectFolder}/src/space/routes/layout.tsx`)
    assertEquals(content.includes('export default function IndexLayout'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLayoutAction should never overwrite an existing layout', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const routeFolder = `${projectFolder}/src/space/routes/products`
  const layoutPath = `${routeFolder}/layout.tsx`

  try {
    await Deno.mkdir(routeFolder, { recursive: true })
    await Deno.writeTextFile(layoutPath, '// customized by hand\n')

    await generateLayoutAction.call(new Commander(), {}, 'products')

    assertEquals(await Deno.readTextFile(layoutPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})
