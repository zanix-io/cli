import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { getLatestVersion, getZanixLibraryVersion } from 'commands/new/lib/tree/info.ts'

// Regression coverage for the A8 audit finding: `getShieldsDataVersion` used to have TWO silent
// fallbacks to the literal string `'latest'` — one for a Shields.io response whose HTML didn't
// match the expected `<title>vX.Y.Z</title>` shape, one in an outer `.catch` for any thrown
// exception (network failure). `'latest'` was never a working substitute either way: JSR's real
// file-serving URLs 404 on that literal segment (empirically confirmed — see this repo's
// `CHANGELOG.md` `[Unreleased]` "Fixed" entry), so the fallback only deferred the failure to a
// second, differently-swallowed spot downstream (`getZanixTemplateContent`'s own former
// `.catch(() => '')`). Both fallbacks are gone; `getLatestVersion` now throws instead.

Deno.test(
  'getLatestVersion throws (never resolves to "latest") when the Shields.io fetch itself fails',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => Promise.reject(new TypeError('stubbed network failure')),
    )

    try {
      await assertRejects(
        () => getLatestVersion('utils'),
        Error,
        '@zanix/utils',
      )
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'getLatestVersion throws (never resolves to "latest") when Shields.io returns unexpected HTML',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('<html><body>rate limited, no title here</body></html>', {
            status: 200,
          }),
        ),
    )

    try {
      await assertRejects(
        () => getLatestVersion('utils'),
        Error,
        '@zanix/utils',
      )
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'getLatestVersion resolves the real version when Shields.io returns the expected HTML shape',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('<html><head><title>v3.2.1</title></head><body></body></html>', {
            status: 200,
          }),
        ),
    )

    try {
      const version = await getLatestVersion('utils')
      assertEquals(version, '3.2.1')
    } finally {
      fetchStub.restore()
    }
  },
)

// Regression coverage for a second, deeper A8 finding surfaced by removing the `'latest'`
// fallback: resolving all nine `ZanixLibraries` up front via one `Promise.all` (the batch approach
// this repo used to have) would mean `getZanixTemplateContent` — which only ever needs ONE of them
// per call (only `'@zanix/utils'` and `'@zanix/core'` are ever requested anywhere under
// `commands/new/lib/tree`, never both at once) — depends on an unrelated, unrequested library too.
// Empirically, `'@zanix/worker'` is not published on JSR (Shields.io's own badge for it literally
// reads `"package not found"`), so a batch lookup would mean `zanix new <anything>` never succeeds
// until that unrelated library gets published. `getZanixLibraryVersion` resolves exactly one
// library instead, so an unrelated library's permanent unavailability can't break it.
Deno.test(
  'getZanixLibraryVersion resolves the one requested library without depending on any other',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString()
        // Simulates the real, confirmed Shields.io response for '@zanix/worker' — genuinely
        // unresolvable — while '@zanix/utils' resolves normally, proving the two are independent.
        if (url.includes('/worker')) {
          return Promise.resolve(
            new Response('<svg><title>package not found</title></svg>', { status: 200 }),
          )
        }
        return Promise.resolve(
          new Response('<html><head><title>v9.9.9</title></head></html>', { status: 200 }),
        )
      },
    )

    try {
      const version = await getZanixLibraryVersion('@zanix/utils')
      assertEquals(version, '9.9.9')

      await assertRejects(() => getZanixLibraryVersion('@zanix/worker'), Error, '@zanix/worker')
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'getZanixLibraryVersion memoizes a successful resolution — a second call for the same library never re-fetches',
  async () => {
    let calls = 0
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => {
        calls++
        return Promise.resolve(
          new Response('<html><head><title>v1.2.3</title></head></html>', { status: 200 }),
        )
      },
    )

    try {
      const first = await getZanixLibraryVersion('@zanix/asyncmq')
      const second = await getZanixLibraryVersion('@zanix/asyncmq')
      assertEquals(first, '1.2.3')
      assertEquals(second, '1.2.3')
      assertEquals(calls, 1, 'the second call must be a pure cache hit, no second fetch')
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'getZanixLibraryVersion never caches a rejection — a later call for the same library can still succeed',
  async () => {
    let calls = 0
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => {
        calls++
        if (calls === 1) return Promise.reject(new TypeError('stubbed transient failure'))
        return Promise.resolve(
          new Response('<html><head><title>v4.5.6</title></head></html>', { status: 200 }),
        )
      },
    )

    try {
      await assertRejects(() => getZanixLibraryVersion('@zanix/datamaster'))
      const version = await getZanixLibraryVersion('@zanix/datamaster')
      assertEquals(version, '4.5.6')
      assertEquals(calls, 2, 'the failed first attempt must not be cached')
    } finally {
      fetchStub.restore()
    }
  },
)
