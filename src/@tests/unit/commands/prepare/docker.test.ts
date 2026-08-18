import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertFalse } from '@std/assert'
import prepareDockerAction from 'commands/prepare/actions/docker.ts'

// deno-lint-ignore no-explicit-any
type FakeCommander = { throw: (e: any) => void }

const temporaryFolder = getTemporaryFolder(import.meta.url)

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
