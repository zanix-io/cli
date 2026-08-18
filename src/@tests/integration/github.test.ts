import { createPreCommitHook } from 'commands/prepare/lib/github/hooks/pre-commit.ts'
import { createPrePushHook } from 'commands/prepare/lib/github/hooks/pre-push.ts'
import { createGitWorkflow } from 'commands/prepare/lib/github/workflows/publish.ts'
import { createWorkflow } from 'commands/prepare/lib/github/workflows/main.ts'
import { prepareGithub } from 'commands/prepare/lib/github/prepare.ts'
import { createIgnoreBaseFile } from 'commands/prepare/lib/github/files/main.ts'
import { fileExists, folderExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { stub } from '@std/testing/mock'
import { gitInitialization } from 'commands/prepare/lib/github/hooks/main.ts'

const defaultFolder = getTemporaryFolder(import.meta.url) + '/github'

// Disable console
stub(console, 'info')
stub(console, 'error')
stub(console, 'warn')

Deno.test('Github create pre-commit hook validation', async () => {
  await gitInitialization(defaultFolder)
  // Call the function passing the file type, for example 'ts'
  const response = await createPreCommitHook({
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
    filePatterns: {
      lint: [
        'ts',
      ],
      fmt: ['ts', 'md'],
    },
  })
  assert(response)
  assert(fileExists(defaultFolder + '/pre-commit'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create pre-commit hook skips creation when the file already exists', async () => {
  await gitInitialization(defaultFolder)
  const hookOptions = {
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
  }

  await createPreCommitHook(hookOptions)
  const response = await createPreCommitHook(hookOptions)

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Git initialization skips `git init` when the repository already exists', async () => {
  await gitInitialization(defaultFolder) // creates the repository
  const gitHooksFolder = await gitInitialization(defaultFolder) // repository already exists

  assertEquals(gitHooksFolder, defaultFolder + '/.git/hooks')
  assert(folderExists(defaultFolder + '/.git'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create pre-push hook validation', async () => {
  await gitInitialization(defaultFolder)
  // Call the function passing the file type, for example 'ts'
  const response = await createPrePushHook({
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
  })
  assert(response)
  assert(fileExists(defaultFolder + '/pre-push'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create publish workflow yaml validation', async () => {
  await gitInitialization(defaultFolder)
  // Call the function passing the file type, for example 'ts'
  const response = await createGitWorkflow({
    baseFolder: defaultFolder,
    baseRoot: '',
    mainBranch: 'myCustomBranch',
  })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/publish.yml')

  assert(content.includes(`pull_request:
    branches:
      - myCustomBranch
  push:
    branches:
      - myCustomBranch`))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github publish workflow skips creation when the YAML already exists', async () => {
  await gitInitialization(defaultFolder)
  const workflowOptions = { baseFolder: defaultFolder, baseRoot: '' }

  await createGitWorkflow(workflowOptions)
  const response = await createGitWorkflow(workflowOptions)

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('createWorkflow defaults to the identity callback', async () => {
  const response = await createWorkflow({
    filename: 'publish',
    baseFolder: defaultFolder,
    baseRoot: '',
  })

  assert(response)
  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github publish workflow returns false for a non-library project type', async () => {
  const response = await createGitWorkflow({
    baseFolder: defaultFolder,
    baseRoot: '',
    projectType: 'server',
  })

  assertFalse(response)
})

Deno.test('Github create gitignorefile validation', async () => {
  // Call the function passing the file type, for example 'ts'
  const response = await createIgnoreBaseFile({ baseRoot: defaultFolder })
  assert(response)

  assert(fileExists(defaultFolder + '/.gitignore'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create gitignorefile skips creation when the file already exists', async () => {
  await createIgnoreBaseFile({ baseRoot: defaultFolder })
  const response = await createIgnoreBaseFile({ baseRoot: defaultFolder })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create gitignorefile returns false when base root creation fails', async () => {
  const blockerFile = defaultFolder + '-blocker'
  await Deno.writeTextFile(blockerFile, '') // a file, not a directory, blocks `Deno.mkdir`

  const response = await createIgnoreBaseFile({ baseRoot: blockerFile })

  assertFalse(response)

  await Deno.remove(blockerFile)
})

Deno.test('Github prepare validation with legacy hooks', async () => {
  const baseFolder = defaultFolder + '/prepare'
  // Call the function passing the file type, for example 'ts'
  const response = await prepareGithub({
    root: defaultFolder,
    legacyHooks: {
      preCommit: { baseFolder, baseRoot: '', createLink: false },
      prePush: { baseFolder, baseRoot: '', createLink: false },
    },
    publishWorkflow: { baseFolder: defaultFolder, baseRoot: '' },
    gitIgnoreBase: { baseRoot: baseFolder },
  })

  assert(response && response.length && !response.includes(false))

  assert(fileExists(baseFolder + '/pre-commit'))
  assert(fileExists(baseFolder + '/pre-push'))
  assert(fileExists(defaultFolder + '/publish.yml'))
  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github prepare validation with pre commit framework', async () => {
  const baseFolder = defaultFolder + '/prepare'
  // Call the function passing the file type, for example 'ts'
  const response = await prepareGithub({
    root: defaultFolder,
    usePrecommit: { baseRoot: baseFolder },
    legacyHooks: {
      preCommit: { baseFolder, baseRoot: '', createLink: false },
      prePush: { baseFolder, baseRoot: '', createLink: false },
    },
    publishWorkflow: { baseFolder: defaultFolder, baseRoot: '' },
    gitIgnoreBase: { baseRoot: baseFolder },
  })

  assert(response && response.length && !response.includes(false))

  assert(fileExists(baseFolder + '/.pre-commit-config.yaml'))
  assert(fileExists(baseFolder + '/pre-commit'))
  assert(fileExists(baseFolder + '/pre-push'))
  assert(fileExists(defaultFolder + '/publish.yml'))
  await new Deno.Command('pre-commit', {
    args: ['uninstall'],
    cwd: baseFolder,
  }).output()
  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github prepare validation with usePrecommit as a boolean flag', async () => {
  const baseFolder = defaultFolder + '/prepare-bool'
  await Deno.mkdir(baseFolder, { recursive: true })
  // `usePrecommit: true` falls back to the default root, so cwd is redirected to a safe temp dir
  const cwdMock = stub(Deno, 'cwd', () => baseFolder)

  try {
    const response = await prepareGithub({
      root: defaultFolder,
      usePrecommit: true,
      legacyHooks: {
        preCommit: { baseFolder, baseRoot: '', createLink: false },
        prePush: { baseFolder, baseRoot: '', createLink: false },
      },
      publishWorkflow: { baseFolder: defaultFolder, baseRoot: '' },
      gitIgnoreBase: { baseRoot: baseFolder },
    })

    assert(response && response.length && !response.includes(false))
    assert(fileExists(baseFolder + '/.pre-commit-config.yaml'))
  } finally {
    await new Deno.Command('pre-commit', {
      args: ['uninstall'],
      cwd: baseFolder,
    }).output()
    cwdMock.restore()
    await Deno.remove(defaultFolder, { recursive: true })
  }
})

Deno.test('Git init should be executed', async () => {
  assertEquals(
    await gitInitialization(defaultFolder),
    defaultFolder + '/.git/hooks',
  )
  assert(folderExists(defaultFolder + '/.git'))

  await Deno.remove(defaultFolder, { recursive: true })
})
