import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse } from '@std/assert'
import prepareDockerAction from 'commands/prepare/actions/docker.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('prepareDockerAction creates Dockerfile + .dockerignore for server', async () => {
  const root = `${temporaryFolder}/with-server`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(fakeCommander as never, { projectType: 'server' }, root)

  assert(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})

Deno.test('prepareDockerAction skips Dockerfile for library, keeps .dockerignore', async () => {
  const root = `${temporaryFolder}/with-library`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(fakeCommander as never, { projectType: 'library' }, root)

  assertFalse(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})
