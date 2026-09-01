import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertThrows } from '@std/assert'
import {
  assertProjectType,
  getCurrentProjectType,
  isZanixDependencyDeclared,
} from 'commands/generate/shared/project.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(zanixProject?: string): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  if (zanixProject !== undefined) {
    await Deno.writeTextFile(
      `${projectFolder}/deno.jsonc`,
      JSON.stringify({ zanix: { project: zanixProject } }),
    )
  }
  return projectFolder
}

Deno.test('getCurrentProjectType reads the zanix.project field via an explicit root', async () => {
  const projectFolder = await makeProject('server')
  assertEquals(getCurrentProjectType(projectFolder), 'server')
  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test('getCurrentProjectType returns undefined when no config file exists', async () => {
  const projectFolder = await makeProject()
  assertEquals(getCurrentProjectType(projectFolder), undefined)
  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test('getCurrentProjectType returns undefined for a malformed config file', async () => {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(`${projectFolder}/deno.jsonc`, '{ not valid json')

  assertEquals(getCurrentProjectType(projectFolder), undefined)
  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test('assertProjectType throws when the project type is not allowed', async () => {
  const projectFolder = await makeProject('library')

  assertThrows(
    () =>
      assertProjectType(
        new Commander(),
        ['server', 'space-server'],
        'seeder',
        projectFolder,
      ),
    Error,
    "must be run inside a 'server' or 'space-server' project",
  )

  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test('assertProjectType does not throw when the project type is allowed', async () => {
  const projectFolder = await makeProject('space-server')

  assertProjectType(
    new Commander(),
    ['server', 'space-server'],
    'seeder',
    projectFolder,
  )

  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test(
  'isZanixDependencyDeclared returns true when the package is in deno.jsonc imports',
  async () => {
    const projectFolder = await makeProject('server')
    const configPath = `${projectFolder}/deno.jsonc`
    const config = JSON.parse(await Deno.readTextFile(configPath))
    config.imports = { '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.2.0' }
    await Deno.writeTextFile(configPath, JSON.stringify(config))

    assertEquals(isZanixDependencyDeclared(projectFolder, '@zanix/datamaster'), true)

    await Deno.remove(projectFolder, { recursive: true })
  },
)

Deno.test('isZanixDependencyDeclared returns false when the package is not declared', async () => {
  const projectFolder = await makeProject('server')

  assertEquals(isZanixDependencyDeclared(projectFolder, '@zanix/datamaster'), false)

  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test('isZanixDependencyDeclared returns false when no config file exists at all', async () => {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })

  assertEquals(isZanixDependencyDeclared(projectFolder, '@zanix/datamaster'), false)

  await Deno.remove(projectFolder, { recursive: true })
})

Deno.test('isZanixDependencyDeclared returns false for a malformed config file', async () => {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(`${projectFolder}/deno.jsonc`, '{ not valid json')

  assertEquals(isZanixDependencyDeclared(projectFolder, '@zanix/datamaster'), false)

  await Deno.remove(projectFolder, { recursive: true })
})
