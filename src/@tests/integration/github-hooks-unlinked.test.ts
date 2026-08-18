import { createPreCommitHook } from 'commands/prepare/lib/github/hooks/pre-commit.ts'
import { getTemporaryFolder } from '@zanix/helpers'
import { assertFalse } from '@std/assert'
import { stub } from '@std/testing/mock'

// Disable console
stub(console, 'error')
stub(console, 'warn')

const defaultFolder = getTemporaryFolder(import.meta.url) +
  '/github-hooks-unlinked'

Deno.test('createHook fails when Git was never initialized in this process', async () => {
  // No `gitInitialization` call in this isolated file, so `baseGitHooksFolder`
  // stays unset and the hook creation must fail after writing the file.
  const response = await createPreCommitHook({
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
  })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})
