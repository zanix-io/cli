import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { assert, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'

/**
 * Every server-tree leaf is generated locally by calling `cli`'s own `generate/` template
 * functions directly — no JSR fetch happens for any of them. This wasn't always true:
 * `connector`/`interactor`/`jobs` used to fetch a static example from `@zanix/server`/
 * `@zanix/asyncmq`'s own `src/templates/` because no `zanix generate` counterpart existed yet for
 * them. Once those generators shipped, the same retirement already applied to
 * `handler`/`rto`/`repository`/`seeder` applied to them too — see `cli/ENGINEERING.md` §5/§7.
 */
async function fetchedJsrPackage(
  content: () => Promise<string>,
): Promise<string | undefined> {
  const requestedUrls: string[] = []
  const fetchStub = stub(
    globalThis,
    'fetch',
    // deno-lint-ignore no-explicit-any
    ((input: any) => {
      requestedUrls.push(String(input))
      return Promise.resolve(new Response('', { status: 404 }))
    }) as typeof fetch,
  )

  try {
    await content()
  } finally {
    fetchStub.restore()
  }

  return requestedUrls.find((url) => url.includes('jsr.io/'))
}

Deno.test('server tree has no jsr-fetched leaf left — every artifact is local', async () => {
  const paths = getZanixPaths('server')
  const server = paths.subfolders.src.subfolders.server

  // Sequential, not `Promise.all` — `fetchedJsrPackage` stubs the shared `globalThis.fetch`, and
  // two concurrent stubs on the same instance method throw.
  const contentGetters = [
    () =>
      server.subfolders.connectors.templates.base[0].content({
        metaUrl: import.meta.url,
      }),
    () =>
      server.subfolders.handlers.templates.base[0].content({
        metaUrl: import.meta.url,
      }),
    () =>
      server.subfolders.handlers.subfolders.rtos.templates.base[0].content({
        metaUrl: import.meta.url,
      }),
    () =>
      server.subfolders.interactors.templates.base[0].content({
        metaUrl: import.meta.url,
      }),
    () =>
      server.subfolders.jobs.templates.base[0].content({
        metaUrl: import.meta.url,
      }),
    () =>
      server.subfolders.repositories.templates.base[0].content({
        metaUrl: import.meta.url,
      }),
    () =>
      server.subfolders.repositories.subfolders.seeders.templates.base[0]
        .content({
          metaUrl: import.meta.url,
        }),
  ]

  for (const getContent of contentGetters) {
    // Must run sequentially: fetchedJsrPackage stubs the shared globalThis.fetch, and two
    // concurrent stubs on the same instance method throw.
    // deno-lint-ignore no-await-in-loop
    assert((await fetchedJsrPackage(getContent)) === undefined)
  }
})

Deno.test("server tree content matches each artifact's own cli generator", async () => {
  const paths = getZanixPaths('server')
  const server = paths.subfolders.src.subfolders.server

  const connectorContent = await server.subfolders.connectors.templates.base[0]
    .content({
      metaUrl: import.meta.url,
    })
  const interactorContent = await server.subfolders.interactors.templates
    .base[0].content({
      metaUrl: import.meta.url,
    })
  const jobContent = await server.subfolders.jobs.templates.base[0].content({
    metaUrl: import.meta.url,
  })
  const handlerContent = await server.subfolders.handlers.templates.base[0]
    .content({
      metaUrl: import.meta.url,
    })
  const rtoContent = await server.subfolders.handlers.subfolders.rtos.templates
    .base[0].content({
      metaUrl: import.meta.url,
    })
  const modelContent = await server.subfolders.repositories.templates.base[0]
    .content({
      metaUrl: import.meta.url,
    })
  const seederContent = await server.subfolders.repositories.subfolders.seeders
    .templates
    .base[0].content({ metaUrl: import.meta.url })

  assertStringIncludes(connectorContent, 'export class ExampleConnector')
  assertStringIncludes(interactorContent, 'export class ExampleService')
  assertStringIncludes(
    jobContent,
    "import { registerCronJob } from '@zanix/asyncmq'",
  )
  assertStringIncludes(handlerContent, 'export class ExampleController')
  assertStringIncludes(rtoContent, 'export class ExampleRTO')
  assertStringIncludes(modelContent, 'export type ExampleAttrs')
  assertStringIncludes(
    seederContent,
    "import { defineSeeders } from 'utils/seeders.ts'",
  )
})
