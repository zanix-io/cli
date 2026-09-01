import { assert, assertRejects } from '@std/assert'
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

// CHANGED per the A8 audit finding: this test used to assert the exact bug being fixed here — a
// non-OK HTTP response (this URL 404s) silently becoming `''`, which every caller then wrote
// straight to disk as a 0-byte file while `zanix new`/`zanix prepare` still reported success. See
// `read-current-file.ts`'s own doc and this repo's `CHANGELOG.md` `[Unreleased]` "Fixed" entry.
Deno.test(
  'readFileFromCurrentUrl throws (never resolves to an empty string) on a failed HTTP fetch',
  async () => {
    await assertRejects(
      () =>
        readFileFromCurrentUrl(
          'https://jsr.io/@zanix/utils/1.1.0/src/modules/helpers/github/hooks/scripts/any.txt',
          'this-file-does-not-exist.txt',
        ),
      Error,
      '404',
    )
  },
)
