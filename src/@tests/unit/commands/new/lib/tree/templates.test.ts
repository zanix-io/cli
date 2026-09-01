import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { getZanixTemplateContent } from 'commands/new/lib/tree/templates.ts'

// Regression coverage for the A8 audit finding: `getZanixTemplateContent` used to swallow ANY
// `readFileFromCurrentUrl` rejection into `''` (`.catch(() => '')`), so a non-OK HTTP response or a
// network failure looked identical to a legitimately empty file — `createFilesAndFolders` then
// wrote that `''` straight to disk. The `.catch` is gone; this proves the rejection now reaches
// the caller.
Deno.test(
  'getZanixTemplateContent propagates a non-OK HTTP response instead of resolving to an empty string',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' })),
    )

    try {
      await assertRejects(
        () =>
          getZanixTemplateContent({
            url: 'https://example.invalid/base/',
            path: 'missing-file.txt',
          }),
        Error,
        '404',
      )
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'getZanixTemplateContent propagates a rejected fetch (network failure) instead of resolving to an empty string',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => Promise.reject(new TypeError('stubbed network failure')),
    )

    try {
      await assertRejects(
        () =>
          getZanixTemplateContent({
            url: 'https://example.invalid/base/',
            path: 'any-file.txt',
          }),
        TypeError,
        'stubbed network failure',
      )
    } finally {
      fetchStub.restore()
    }
  },
)

// Wiring coverage for the `jsr` path specifically — `getZanixLibraryVersion` (`info.ts`) resolves
// ONE library's version, then this builds the real `https://jsr.io/<lib>/<version>/{current}` URL
// from it. See `info.test.ts`'s own `getZanixLibraryVersion` tests for why this resolves just the
// one requested library, never an all-nine-libraries batch.
Deno.test(
  'getZanixTemplateContent resolves real content through the jsr version lookup',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url.includes('img.shields.io')) {
          return Promise.resolve(
            new Response('<html><head><title>v7.7.7</title></head></html>', { status: 200 }),
          )
        }
        return Promise.resolve(
          new Response('the real jsr file content', { status: 200 }),
        )
      },
    )

    try {
      const content = await getZanixTemplateContent({
        url: 'https://jsr.io/@zanix/utils/ignored/whatever.ts',
        path: 'README.md',
        jsr: '@zanix/utils',
      })
      assertEquals(content, 'the real jsr file content')
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'getZanixTemplateContent propagates a jsr version-lookup failure instead of resolving to an empty string',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('<svg><title>package not found</title></svg>', { status: 200 }),
        ),
    )

    try {
      await assertRejects(
        () =>
          getZanixTemplateContent({
            url: 'https://jsr.io/@zanix/worker/ignored/whatever.ts',
            path: 'README.md',
            jsr: '@zanix/worker',
          }),
        Error,
        '@zanix/worker',
      )
    } finally {
      fetchStub.restore()
    }
  },
)
