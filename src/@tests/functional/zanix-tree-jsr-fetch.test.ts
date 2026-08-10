import { getAllZanixLibrariesInfo } from 'commands/new/lib/tree/info.ts'
import { versionRegex } from '@zanix/utils/regex'
import { assertMatch } from '@std/assert/assert-match'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { assert } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'

Deno.test('Fetching Zanix lates release validation', async () => {
  const result = await getAllZanixLibrariesInfo()

  assertMatch(result['@zanix/utils'].version, versionRegex)
  assertMatch(result['@zanix/app'].version, versionRegex)
  assertMatch(result['@zanix/asyncmq'].version, versionRegex)
  assertMatch(result['@zanix/auth'].version, versionRegex)
  assertMatch(result['@zanix/core'].version, versionRegex)
  assertMatch(result['@zanix/datamaster'].version, versionRegex)
  assertMatch(result['@zanix/notifications'].version, versionRegex)
  assertMatch(result['@zanix/server'].version, versionRegex)
  assertMatch(result['@zanix/worker'].version, versionRegex)
})

/**
 * The JSR-tagged templates always resolve their content from the latest package
 * *published* on jsr.io. That lags behind local template path changes until a
 * release is actually published, so this stubs `fetch` to serve those requests
 * from the local repo (the one about to be published) instead of the registry.
 *
 * This mechanism moved from `@zanix/utils` to `@zanix/cli`, but the default (no-`type`) tree it's
 * being tested against here still fetches `@zanix/utils`'s own scaffold content (README/LICENSE/
 * example files) — so `repoRoot` must point at the sibling `utils` checkout, not at this file's
 * own repo, unlike the original (pre-move) version of this test.
 */
function stubJsrTemplateFetch() {
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '../../../../utils')
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : input.toString()
    // `getPathFromCurrent` builds this url via path `join`, which can collapse
    // the `//` after the scheme (e.g. `https:/jsr.io/...`); `new URL` normalizes it.
    const { hostname, pathname } = new URL(rawUrl)
    const match = hostname === 'jsr.io' && pathname.match(/^\/@zanix\/utils\/[^/]+\/(.+)$/)

    if (!match) return originalFetch(input, init)

    try {
      const content = await Deno.readTextFile(join(repoRoot, match[1]))
      return new Response(content, { status: 200 })
    } catch {
      return new Response(null, { status: 404 })
    }
  }) as typeof fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

Deno.test('getZanixPaths should return correct default content from jsr', async () => {
  const restoreFetch = stubJsrTemplateFetch()

  try {
    const paths = getZanixPaths('library', '')

    const contentUtils = await paths.subfolders.src.subfolders.utils.templates.base[0].content({
      metaUrl: import.meta.url,
    })

    assert(contentUtils.includes('Utilities Module Template'))

    const contentMod = await paths.templates.base[3].content({
      metaUrl: import.meta.url,
    })

    assert(contentMod.includes('Module Template'))

    const contentSecondaryMod = await paths.subfolders.src.subfolders.modules.templates.base[0]
      .content({
        metaUrl: import.meta.url,
      })

    assert(contentSecondaryMod.includes('export default module'))

    const contentLicense = await paths.templates.base[2].content({
      metaUrl: import.meta.url,
    })

    assert(contentLicense.includes('License'))
  } finally {
    restoreFetch()
  }
})
