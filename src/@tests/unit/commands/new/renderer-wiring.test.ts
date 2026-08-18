import { assert, assertFalse } from '@std/assert'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { SPACE_APP_MODULE } from 'commands/new/lib/tree/projects/space.ts'

/** End-to-end proof that `--renderer` actually reaches the real, assembled `space.app.ts` node
 * `getZanixPaths` produces — not just `getSpaceAppTemplate` in isolation (see
 * `tree/projects/space-app-template.test.ts` for that unit-level coverage). Exercises the full
 * `getZanixPaths` → `getZnxFolderTree` → `getSpaceAppTemplate` chain `zanix new space`/`zanix new
 * spacecraft` themselves rely on.
 *
 * `root` must be UNIQUE per call: `getCommonTree`'s own module-level cache (confirmed in
 * `zanix-trees-cache.test.ts`) returns the exact same tree object for two calls sharing a root,
 * regardless of any other argument — a shared root across these test cases would accumulate every
 * prior call's own `space.app.ts` push onto the SAME cached `templates.base` array, and `.find()`
 * would silently resolve the FIRST one ever pushed, not the one this specific call just built. */
// Deliberately never contains the substring "renderer" — the assembled space.app.ts writes this
// value back verbatim as the project's own `name`, and one test below asserts the ABSENCE of that
// substring in the whole file; a fixture name containing it would trivially self-match.
let callCounter = 0
async function spaceAppContent(
  type: 'space' | 'space-server',
  renderer?: 'react' | 'preact',
): Promise<string> {
  const root = `/tmp/zanix-cli-rw-fixture-${callCounter++}`
  const paths = getZanixPaths(type, root, 'base', renderer)
  const entry = paths.templates.base.find((file) => file.NAME === SPACE_APP_MODULE)
  assert(entry, `expected a ${SPACE_APP_MODULE} entry in the assembled tree`)
  return await entry.content({ metaUrl: import.meta.url })
}

Deno.test(
  "getZanixPaths('space', ...): renderer omitted never writes a renderer field",
  async () => {
    const content = await spaceAppContent('space')
    assertFalse(content.includes('renderer'), content)
  },
)

Deno.test(
  "getZanixPaths('space', ..., 'preact'): writes a real renderer: 'preact' field into the " +
    'assembled space.app.ts',
  async () => {
    const content = await spaceAppContent('space', 'preact')
    assert(content.includes("renderer: 'preact',"), content)
  },
)

Deno.test(
  "getZanixPaths('space-server', ..., 'preact'): the full-stack (spacecraft) tree threads " +
    'renderer through identically to plain space',
  async () => {
    const content = await spaceAppContent('space-server', 'preact')
    assert(content.includes("renderer: 'preact',"), content)
  },
)
