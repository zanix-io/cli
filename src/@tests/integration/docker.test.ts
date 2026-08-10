import { createDockerfile } from 'commands/prepare/lib/docker/files/docker-file.ts'
import { createDockerignoreFile } from 'commands/prepare/lib/docker/files/dockerignore.ts'
import { prepareDocker } from 'commands/prepare/lib/docker/prepare.ts'
import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse } from '@std/assert'
import { stub } from '@std/testing/mock'

const defaultFolder = getTemporaryFolder(import.meta.url) + '/docker'

// Disable console
stub(console, 'info')
stub(console, 'error')
stub(console, 'warn')

Deno.test('Docker create Dockerfile for a server project', async () => {
  const response = await createDockerfile({ baseRoot: defaultFolder, projectType: 'server' })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')

  assert(content.includes('8000'))
  assert(content.includes('mod.ts'))
  assert(content.includes('deno cache'))
  assertFalse(content.includes('deno install'))
  assertFalse(content.includes('node_modules'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile for a space project', async () => {
  const response = await createDockerfile({ baseRoot: defaultFolder, projectType: 'space' })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')

  assert(content.includes('deno install'))
  assert(content.includes('jsr:@zanix/cli space build'))
  assert(content.includes('dist/client'))
  assert(content.includes('COPY --from=build'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile for a space-server project', async () => {
  const response = await createDockerfile({ baseRoot: defaultFolder, projectType: 'space-server' })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')

  assert(content.includes('deno install'))
  assert(content.includes('jsr:@zanix/cli space build'))
  assert(content.includes('dist/client'))
  assert(content.includes('COPY --from=build'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile returns false for a library project', async () => {
  const response = await createDockerfile({ baseRoot: defaultFolder, projectType: 'library' })
  assertFalse(response)
  assertFalse(fileExists(defaultFolder + '/Dockerfile'))
})

Deno.test('Docker create Dockerfile returns false for an app project', async () => {
  const response = await createDockerfile({ baseRoot: defaultFolder, projectType: 'app' })
  assertFalse(response)
  assertFalse(fileExists(defaultFolder + '/Dockerfile'))
})

Deno.test('Docker Dockerfile creation skips when the file already exists', async () => {
  await createDockerfile({ baseRoot: defaultFolder, projectType: 'server' })
  const response = await createDockerfile({ baseRoot: defaultFolder, projectType: 'server' })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create .dockerignore validation', async () => {
  const response = await createDockerignoreFile({ baseRoot: defaultFolder })
  assert(response)
  assert(fileExists(defaultFolder + '/.dockerignore'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker .dockerignore creation skips when the file already exists', async () => {
  await createDockerignoreFile({ baseRoot: defaultFolder })
  const response = await createDockerignoreFile({ baseRoot: defaultFolder })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker prepare validation writes both files for a server project', async () => {
  const response = await prepareDocker({
    dockerfile: { baseRoot: defaultFolder, projectType: 'server' },
    dockerIgnore: { baseRoot: defaultFolder },
  })

  assert(response.length === 2 && !response.includes(false))
  assert(fileExists(defaultFolder + '/Dockerfile'))
  assert(fileExists(defaultFolder + '/.dockerignore'))

  await Deno.remove(defaultFolder, { recursive: true })
})
