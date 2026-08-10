import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse } from '@std/assert'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// `deno.jsonc`'s own `"prepare"` task hardcodes `-g -e`, so it can't be reused (the way
// `commands.new.test.ts` reuses the `"new"` task) to test `--docker` in isolation — `mod.ts` is
// invoked directly instead, real subprocess, same style as every other functional test here.

Deno.test('prepare --docker creates Dockerfile + .dockerignore for server', async () => {
  const project = `${temporaryFolder}/server-docker`
  await Deno.mkdir(project, { recursive: true })

  await new Deno.Command('deno', {
    args: ['run', '-A', 'mod.ts', 'prepare', '--docker', '-p', 'server', project],
  }).output()

  assert(fileExists(project + '/Dockerfile'))
  assert(fileExists(project + '/.dockerignore'))

  const dockerfile = await Deno.readTextFile(project + '/Dockerfile')
  assert(dockerfile.includes('CMD ["task", "start"]'))

  await Deno.remove(project, { recursive: true })
})

Deno.test('prepare --docker creates a space-aware Dockerfile for space-server', async () => {
  const project = `${temporaryFolder}/space-server-docker`
  await Deno.mkdir(project, { recursive: true })

  await new Deno.Command('deno', {
    args: ['run', '-A', 'mod.ts', 'prepare', '--docker', '-p', 'space-server', project],
  }).output()

  const dockerfile = await Deno.readTextFile(project + '/Dockerfile')
  assert(dockerfile.includes('deno install'))
  assert(dockerfile.includes('dist/client'))

  await Deno.remove(project, { recursive: true })
})

Deno.test('prepare --docker skips Dockerfile but writes .dockerignore for library', async () => {
  const project = `${temporaryFolder}/library-docker`
  await Deno.mkdir(project, { recursive: true })

  await new Deno.Command('deno', {
    args: ['run', '-A', 'mod.ts', 'prepare', '--docker', '-p', 'library', project],
  }).output()

  assertFalse(fileExists(project + '/Dockerfile'))
  assert(fileExists(project + '/.dockerignore'))

  await Deno.remove(project, { recursive: true })
})
