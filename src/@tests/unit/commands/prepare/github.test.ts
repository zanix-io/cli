import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse, assertStringIncludes, assertThrows } from '@std/assert'
import prepareGithubAction from 'commands/prepare/actions/github.ts'
import { Commander } from 'cli'

// deno-lint-ignore no-explicit-any
type FakeCommander = { throw: (e: any) => void }

const temporaryFolder = getTemporaryFolder(import.meta.url)

console.error = () => {}

async function fileExistsAt(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false)
}

/**
 * `Promise.all([createGitWorkflows, createIgnoreBaseFile, createPreCommitHook, createPrePushHook])`
 * (`prepareGithub`'s own body) rejects as soon as the first of those rejects — the others keep
 * writing, unawaited, in the background. A plain `Deno.remove(root, { recursive: true })` can lose
 * a benign race against one of those still-in-flight writes (`ENOTEMPTY`) — retried here rather
 * than fixed with a timing-based `sleep`, matching `docker.test.ts`'s own identical helper for the
 * identical reason.
 */
async function removeDirWithRetry(path: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.remove(path, { recursive: true })
      return
    } catch (error) {
      if (attempt === attempts) throw error
      // deno-lint-ignore no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

Deno.test('prepareGithubAction should apply fmtFiles, lintFiles and hooksEngine', async () => {
  const root = `${temporaryFolder}/with-options`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareGithubAction.call(
    fakeCommander as never,
    {
      projectType: 'library',
      fmtFiles: 'ts,md',
      lintFiles: 'ts',
      hooksEngine: 'framework',
    },
    root,
  )

  assert(
    await Deno.stat(`${root}/.pre-commit-config.yaml`).then(() => true).catch(
      () => false,
    ),
  )
  assert(await fileExistsAt(`${root}/.github/workflows/publish.yml`))

  await Deno.remove(root, { recursive: true })
})

Deno.test('prepareGithubAction creates a publish workflow for app', async () => {
  const root = `${temporaryFolder}/with-app`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareGithubAction.call(fakeCommander as never, { projectType: 'app' }, root)

  assert(await fileExistsAt(`${root}/.github/workflows/publish.yml`))

  await Deno.remove(root, { recursive: true })
})

Deno.test(
  'prepareGithubAction creates a CI workflow (no publish step) for server/space/space-server',
  async () => {
    const projectTypes = ['server', 'space', 'space-server']

    // Sequential on purpose, not `Promise.all`: `createHook`'s symlink step targets a shared,
    // module-level `baseGitHooksFolder` — running these concurrently makes two iterations race to
    // symlink the same `.git/hooks/pre-commit`/`pre-push` name, which is a real collision in
    // `createHook` itself, not something this test is trying to exercise.
    for (const projectType of projectTypes) {
      const root = `${temporaryFolder}/with-${projectType}`
      // deno-lint-ignore no-await-in-loop
      await Deno.mkdir(root, { recursive: true })

      const fakeCommander = { throw: () => {} }

      // deno-lint-ignore no-await-in-loop
      await prepareGithubAction.call(fakeCommander as never, { projectType }, root)

      // deno-lint-ignore no-await-in-loop
      assert(await fileExistsAt(`${root}/.github/workflows/ci.yml`))
      // deno-lint-ignore no-await-in-loop
      assertFalse(await fileExistsAt(`${root}/.github/workflows/publish.yml`))

      // deno-lint-ignore no-await-in-loop
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'prepareGithubAction defaults to the library publish workflow when projectType is undefined',
  async () => {
    const root = `${temporaryFolder}/with-undefined`
    await Deno.mkdir(root, { recursive: true })

    const fakeCommander = { throw: () => {} }

    await prepareGithubAction.call(fakeCommander as never, {}, root)

    assert(await fileExistsAt(`${root}/.github/workflows/publish.yml`))

    await Deno.remove(root, { recursive: true })
  },
)

Deno.test(
  'prepareGithubAction rejects an invalid projectType before writing anything, via this.throw',
  async () => {
    const root = `${temporaryFolder}/with-invalid-project-type`
    await Deno.mkdir(root, { recursive: true })

    try {
      // The guard runs synchronously before `prepareGithub(...)` is ever called, so the action
      // itself throws synchronously here rather than returning a rejected promise.
      assertThrows(
        () => prepareGithubAction.call(new Commander(), { projectType: 'foobra' }, root),
        Error,
        "Invalid project type 'foobra' using cli command. Allowed values are: 'library', 'server', 'space', 'space-server', 'app'",
      )

      assertFalse(await fileExistsAt(`${root}/.github/workflows/publish.yml`))
      assertFalse(await fileExistsAt(`${root}/.pre-commit-config.yaml`))
      // `prepareGithub`'s other files (`.gitignore`, the legacy hook scripts, `git init`) are
      // written unconditionally per `prepareGithub`'s own doc — the same "partial output" shape
      // the docker regression test guards against. The guard throwing before `prepareGithub(...)`
      // runs at all means NONE of them get created either.
      assertFalse(await fileExistsAt(`${root}/.gitignore`))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'prepareGithubAction routes a genuine createHook write failure through this.throw, not exit 0',
  async () => {
    // Locks in the swallow→re-throw fix in `commands/prepare/lib/github/hooks/main.ts`'s own
    // `createHook`: a blocker FILE at `${root}/.github` forces the real `Deno.mkdir(dir, {
    // recursive: true })` inside `createHook` (both the pre-commit and pre-push hook writers land
    // under `GITHUB_HOOKS_FOLDER`, `.github/hooks`) to fail for real — not the benign "hook already
    // exists, skip" branch, and not a validation-time throw either. Before the fix, that failure
    // was swallowed into `return false`, which nothing here checked, and the action exited 0
    // regardless — mirrors `docker.test.ts`'s identical "blocker file" regression test for
    // `prepareDockerAction`.
    const root = `${temporaryFolder}/with-blocked-github-folder`
    await Deno.mkdir(root, { recursive: true })
    await Deno.writeTextFile(`${root}/.github`, '')

    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await prepareGithubAction.call(fakeCommander as never, { projectType: 'library' }, root)

      assert(thrown, 'expected this.throw to have been called')
      assertStringIncludes((thrown as Error).message, 'mkdir')
    } finally {
      await removeDirWithRetry(root)
    }
  },
)
