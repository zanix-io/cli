import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { assert, assertExists, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'

/**
 * `library`'s own root `mod.ts` and `src/modules/mod.ts` are both generated locally now — no JSR
 * fetch happens for either. This wasn't always true: both used to be a single static placeholder
 * fetched from `@zanix/utils`'s own `src/templates/` (see `cli/engineering.md` §5/§7 and
 * `library.ts`'s own `getLibraryRootModTemplate`/`getLibraryModTemplate` doc for the full
 * reasoning). Same stub-and-assert-no-`jsr.io`-request shape as
 * `zanix-server-template-ownership.test.ts`'s own `fetchedJsrPackage`.
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

Deno.test(
  "library's root mod.ts and src/modules/mod.ts are both local — no jsr-fetched leaf left",
  async () => {
    const paths = getZanixPaths('library', 'my-zanix-library')
    const rootMod = paths.templates.base.find((file) => file.NAME === 'mod.ts')
    const moduleMod = paths.subfolders.src.subfolders.modules.templates.base[0]

    assertExists(rootMod, "library's package root must carry a mod.ts entry")

    // Sequential, not `Promise.all` — `fetchedJsrPackage` stubs the shared `globalThis.fetch`, and
    // two concurrent stubs on the same instance method throw.
    assert(
      (await fetchedJsrPackage(() => rootMod.content({ metaUrl: import.meta.url }))) ===
        undefined,
    )
    assert(
      (await fetchedJsrPackage(() => moduleMod.content({ metaUrl: import.meta.url }))) ===
        undefined,
    )
  },
)

Deno.test("library tree content matches library.ts's own generator functions", async () => {
  const paths = getZanixPaths('library', 'my-zanix-library')
  const rootMod = paths.templates.base.find((file) => file.NAME === 'mod.ts')
  const moduleMod = paths.subfolders.src.subfolders.modules.templates.base[0]

  assertExists(rootMod, "library's package root must carry a mod.ts entry")

  const rootModContent = await rootMod.content({ metaUrl: import.meta.url })
  const moduleModContent = await moduleMod.content({ metaUrl: import.meta.url })

  assertStringIncludes(rootModContent, "export * from './src/modules/mod.ts'")
  assertStringIncludes(rootModContent, 'my-zanix-library')
  assertStringIncludes(moduleModContent, 'export function example')
  assertStringIncludes(moduleModContent, 'my-zanix-library')
})
