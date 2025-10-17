import { fileExists, folderExists, getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('new command server should create some base folders', async () => {
  const project = `${temporaryFolder}/server-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'server', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(!folderExists(project + '/.github/workflows'))

  assert(folderExists(project + '/src/server'))
  assert(!folderExists(project + '/src/app'))
  assert(!folderExists(project + '/src/modules'))

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command app should create some base folders', async () => {
  const project = `${temporaryFolder}/app-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'app', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(!folderExists(project + '/.github/workflows'))

  assert(!folderExists(project + '/src/server'))
  assert(folderExists(project + '/src/app'))
  assert(!folderExists(project + '/src/modules'))

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command project should create some base folders', async () => {
  const project = `${temporaryFolder}/project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'project', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(!folderExists(project + '/.github/workflows'))

  assert(folderExists(project + '/src/server'))
  assert(folderExists(project + '/src/app'))
  assert(!folderExists(project + '/src/modules'))

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command library should create some base folders', async () => {
  const project = `${temporaryFolder}/library-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'library', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(fileExists(project + '/.github/workflows/publish.yml'))

  assert(!folderExists(project + '/src/server'))
  assert(!folderExists(project + '/src/app'))
  assert(folderExists(project + '/src/modules'))

  await Deno.remove(project, { recursive: true })
})
