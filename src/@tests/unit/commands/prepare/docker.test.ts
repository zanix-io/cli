import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse, assertStringIncludes, assertThrows } from '@std/assert'
import prepareDockerAction from 'commands/prepare/actions/docker.ts'
import { Commander } from 'cli'

// deno-lint-ignore no-explicit-any
type FakeCommander = { throw: (e: any) => void }

const temporaryFolder = getTemporaryFolder(import.meta.url)

console.error = () => {}

/**
 * `Promise.all([createAppServeEntrypoint(opts), ensureAppServeTask(opts.baseRoot)])`
 * (`docker-file.ts`'s own `'app'` branch) rejects as soon as EITHER promise rejects —
 * `ensureAppServeTask`'s malformed-config throw wins that race in the test below, but
 * `createAppServeEntrypoint`'s own `serve.ts` write keeps running, unawaited, in the background.
 * A plain `Deno.remove(root, { recursive: true })` can lose a benign race against that still-in-
 * flight write (`ENOTEMPTY`) — retried here rather than fixed with a timing-based `sleep`, since
 * the write settles almost immediately.
 */
async function removeDirWithRetry(path: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      await Deno.remove(path, { recursive: true })
      return
    } catch (error) {
      if (attempt === attempts) throw error
      // Sequential retry-with-backoff — each attempt must wait for the previous one to fail
      // before trying again, so this can't be hoisted into a `Promise.all` the way the lint rule
      // expects.
      // deno-lint-ignore no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

Deno.test('prepareDockerAction creates Dockerfile + .dockerignore for server', async () => {
  const root = `${temporaryFolder}/with-server`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(fakeCommander as never, {
    projectType: 'server',
  }, root)

  assert(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})

Deno.test('prepareDockerAction creates Dockerfile + serve.ts + .dockerignore for app', async () => {
  const root = `${temporaryFolder}/with-app`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(
    fakeCommander as never,
    { projectType: 'app' },
    root,
  )

  assert(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/serve.ts`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})

Deno.test('prepareDockerAction skips Dockerfile for library, keeps .dockerignore', async () => {
  const root = `${temporaryFolder}/with-library`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(fakeCommander as never, {
    projectType: 'library',
  }, root)

  assertFalse(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})

Deno.test(
  'prepareDockerAction routes a genuine file-write failure through this.throw, not exit 0',
  async () => {
    // Locks in the actual exit-code bug this fix targets: a real write failure deep in
    // `createDockerBaseFile` previously logged and resolved `false`, which nothing here checked —
    // the action exited 0 regardless. A file where `Deno.mkdir(baseRoot, ...)` needs a directory
    // is a genuine, portable way to force that real failure (not a validation-time throw, and not
    // the benign "already exists" skip, which must NOT reach `this.throw` — see the other tests
    // in this file for that case).
    const blockerFile = `${temporaryFolder}/blocker-${crypto.randomUUID()}`
    await Deno.writeTextFile(blockerFile, '')

    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await prepareDockerAction.call(fakeCommander as never, { projectType: 'server' }, blockerFile)

      assert(thrown, 'expected this.throw to have been called')
      // `createDockerBaseFile` re-throws the raw `Deno.mkdir` error as-is (only logging its own
      // "file creation error" message, not wrapping it) — the action's `.catch(this.throw)` still
      // sees it either way, which is the actual regression this test guards against.
      assertStringIncludes((thrown as Error).message, 'mkdir')
    } finally {
      await Deno.remove(blockerFile)
    }
  },
)

Deno.test(
  'prepareDockerAction routes a real prepareDocker rejection through this.throw',
  async () => {
    const root = `${temporaryFolder}/with-broken-config`
    await Deno.mkdir(root, { recursive: true })
    // 'app' scaffolding reads this project's own deno.json (`ensureAppServeTask`'s own
    // `readConfig`) with no try/catch around it — malformed JSON here throws synchronously,
    // rejecting `prepareDocker`'s `Promise.all` and exercising the action's own `.catch` wiring.
    await Deno.writeTextFile(`${root}/deno.json`, '{ not valid json')

    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await prepareDockerAction.call(fakeCommander as never, { projectType: 'app' }, root)

      assert(thrown, 'expected this.throw to have been called')
    } finally {
      await removeDirWithRetry(root)
    }
  },
)

Deno.test('prepareDockerAction creates Dockerfile + .dockerignore for space', async () => {
  const root = `${temporaryFolder}/with-space`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(fakeCommander as never, {
    projectType: 'space',
  }, root)

  assert(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})

Deno.test('prepareDockerAction creates Dockerfile + .dockerignore for space-server', async () => {
  const root = `${temporaryFolder}/with-space-server`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareDockerAction.call(fakeCommander as never, {
    projectType: 'space-server',
  }, root)

  assert(fileExists(`${root}/Dockerfile`))
  assert(fileExists(`${root}/.dockerignore`))

  await Deno.remove(root, { recursive: true })
})

Deno.test(
  'prepareDockerAction defaults to the server Dockerfile when projectType is undefined',
  async () => {
    const root = `${temporaryFolder}/with-undefined`
    await Deno.mkdir(root, { recursive: true })

    const fakeCommander = { throw: () => {} }

    await prepareDockerAction.call(fakeCommander as never, {}, root)

    assert(fileExists(`${root}/Dockerfile`))
    assert(fileExists(`${root}/.dockerignore`))

    await Deno.remove(root, { recursive: true })
  },
)

Deno.test(
  'prepareDockerAction rejects an invalid projectType before writing anything, via this.throw',
  async () => {
    const root = `${temporaryFolder}/with-invalid-project-type`
    await Deno.mkdir(root, { recursive: true })

    try {
      // The guard runs synchronously before `prepareDocker(...)` is ever called, so the action
      // itself throws synchronously here rather than returning a rejected promise.
      assertThrows(
        () => prepareDockerAction.call(new Commander(), { projectType: 'foobra' }, root),
        Error,
        "Invalid project type 'foobra' using cli command. Allowed values are: 'library', 'server', 'space', 'space-server', 'app'",
      )

      // The regression this locks in: an invalid value used to still produce partial output
      // (`.dockerignore` written unconditionally, `Dockerfile` silently not) because nothing
      // validated `--project-type` before `prepareDocker(...)` ran. Now neither file is written at
      // all — the guard throws before any work starts.
      assertFalse(fileExists(`${root}/Dockerfile`))
      assertFalse(fileExists(`${root}/.dockerignore`))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
