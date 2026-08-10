import { assert } from '@std/assert'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'

Deno.test('readFileFromCurrentUrl should return a url file content', async () => {
  const remoteContent = await readFileFromCurrentUrl(
    'https://jsr.io/@zanix/utils/1.1.0/src/modules/helpers/github/hooks/scripts/any.txt',
    'pre-commit.base.sh',
  )

  assert(remoteContent !== '')

  const localContent = await readFileFromCurrentUrl(
    import.meta.url,
    'read-current-file.test.ts',
  )

  assert(localContent.includes('Deno.test'))
})

Deno.test('readFileFromCurrentUrl returns an empty string on a failed HTTP fetch', async () => {
  const content = await readFileFromCurrentUrl(
    'https://jsr.io/@zanix/utils/1.1.0/src/modules/helpers/github/hooks/scripts/any.txt',
    'this-file-does-not-exist.txt',
  )

  assert(content === '')
})
