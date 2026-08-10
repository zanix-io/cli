import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import prepareGithubAction from 'commands/prepare/actions/github.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('prepareGithubAction should apply fmtFiles, lintFiles and usePrecommit', async () => {
  const root = `${temporaryFolder}/with-options`
  await Deno.mkdir(root, { recursive: true })

  const fakeCommander = { throw: () => {} }

  await prepareGithubAction.call(
    fakeCommander as never,
    { projectType: 'library', fmtFiles: 'ts,md', lintFiles: 'ts', usePrecommit: true },
    root,
  )

  assert(await Deno.stat(`${root}/.pre-commit-config.yaml`).then(() => true).catch(() => false))

  await Deno.remove(root, { recursive: true })
})
