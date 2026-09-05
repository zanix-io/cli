import { assert, assertEquals, assertRejects } from '@std/assert'
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

// A non-OK HTTP response never silently becomes `''` here — every real caller (`zanix new`/
// `zanix prepare`'s scaffolding) would otherwise write that straight to disk as a 0-byte file
// while still reporting success. See `read-current-file.ts`'s own doc for the full contract.
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

/** A real local server, deliberately never `fetch` itself mocked — same "no mocking a network
 * boundary this repo doesn't own" discipline the rest of this file already follows for `jsr.io`,
 * just against a server this test controls instead. `port: 0` lets Deno pick a free one; the real
 * assigned port is read back off `server.addr`. */
function withCountingServer(
  handler: (requestNumber: number) => Response,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  let requestNumber = 0
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => handler(++requestNumber),
  )
  const { port } = server.addr as Deno.NetAddr
  return run(`http://localhost:${port}/placeholder.txt`).finally(() => server.shutdown())
}

Deno.test(
  'readFileFromCurrentUrl retries a transient 503, then succeeds once the server recovers',
  async () => {
    await withCountingServer(
      (requestNumber) =>
        requestNumber < 3
          ? new Response('temporarily unavailable', { status: 503 })
          : new Response('real content'),
      async (baseUrl) => {
        const content = await readFileFromCurrentUrl(baseUrl, 'target.txt')
        assertEquals(content, 'real content')
      },
    )
  },
)

Deno.test(
  'readFileFromCurrentUrl never retries a 404 — fails on the first attempt, no delay',
  async () => {
    let requestCount = 0
    await withCountingServer(
      (requestNumber) => {
        requestCount = requestNumber
        return new Response('not found', { status: 404 })
      },
      async (baseUrl) => {
        await assertRejects(() => readFileFromCurrentUrl(baseUrl, 'target.txt'), Error, '404')
      },
    )
    assertEquals(requestCount, 1)
  },
)

Deno.test(
  'readFileFromCurrentUrl gives up after exhausting every retry against a server that never recovers',
  async () => {
    let requestCount = 0
    await withCountingServer(
      (requestNumber) => {
        requestCount = requestNumber
        return new Response('down', { status: 503 })
      },
      async (baseUrl) => {
        await assertRejects(() => readFileFromCurrentUrl(baseUrl, 'target.txt'), Error, '503')
      },
    )
    assertEquals(requestCount, 3)
  },
)
