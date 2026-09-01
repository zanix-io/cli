import { createPreCommitHook } from 'commands/prepare/lib/github/hooks/pre-commit.ts'
import { getTemporaryFolder } from '@zanix/helpers'
import { assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'

// Disable console
stub(console, 'error')
stub(console, 'warn')

// A fresh, unique folder per run — not a fixed `/github-hooks-unlinked` path — so a prior
// interrupted/failed run's own leftover `pre-commit` file can never be mistaken for "already
// exists, skip creation" here (that branch returns `false` before ever reaching the
// `baseGitHooksFolder` check this test exists to exercise). Matches `docker.test.ts`'s own
// `crypto.randomUUID()` blocker-file pattern for the same reason.
const defaultFolder = `${
  getTemporaryFolder(import.meta.url)
}/github-hooks-unlinked-${crypto.randomUUID()}`

Deno.test('createHook fails when Git was never initialized in this process', async () => {
  try {
    // No `gitInitialization` call in this isolated file, so `baseGitHooksFolder` stays unset and
    // `createHook`'s own guard now rejects instead of silently resolving `false` — see
    // `main.ts`'s swallow→re-throw fix.
    await assertRejects(
      () =>
        createPreCommitHook({
          baseFolder: defaultFolder,
          baseRoot: '',
          createLink: false,
        }),
      Error,
      'Please verify your Git initialization and try running the znx prepare command again.',
    )
  } finally {
    await Deno.remove(defaultFolder, { recursive: true })
  }
})
