import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { stub } from '@std/testing/mock'
import { Commander } from 'cli'
import newServerAction from 'commands/new/actions/server.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// Regression coverage for the A8 audit finding: a failed template-content fetch (no network, JSR
// down) used to be swallowed all the way down to `''`, which `createFilesAndFolders` then wrote
// straight to disk as a 0-byte file while `newServerAction` still ran to completion and logged
// success. `readFileFromCurrentUrl`/`getZanixTemplateContent`/`getShieldsDataVersion` no longer
// swallow that failure (see `utils/read-current-file.ts` and `commands/new/lib/tree/{templates,
// info}.ts`'s own doc/CHANGELOG entries) — this proves the fix from the actual `zanix new server`
// action's own point of view: `newServerAction` has NO local try/catch around its
// `createFilesAndFolders` call (unlike the `assertSafeProjectName`/`getZanixPaths` block above
// it), so this also empirically answers the "does an unhandled rejection from an async action
// surface correctly" question — a plain, uncaught `await` inside an `async function` always
// rejects that function's own returned promise, per JS semantics; no extra try/catch is needed
// here. `deno test`'s own `assertRejects` below observes exactly that.
Deno.test(
  'newServerAction propagates a template-fetch failure instead of writing 0-byte files',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const projectPath = join(root, 'my-server')

    // Every `README.md`/`LICENSE`/etc. template file in the common tree is JSR-tagged (see
    // `commands/new/lib/tree/projects/commons.ts`), so its content is fetched over HTTP(S); every
    // other file in the tree is read straight off this repo's own local disk (`isFileUrl` short
    // circuit in `readFileFromCurrentUrl`), never touching `fetch` at all. Rejecting every `fetch`
    // call here reproduces "no network"/"JSR down" for exactly the files that were previously
    // affected by the swallow bug.
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => Promise.reject(new TypeError('stubbed network failure: no network available')),
    )

    try {
      await assertRejects(
        () => newServerAction.call(new Commander(), { template: 'base' }, projectPath),
        Error,
      )
    } finally {
      fetchStub.restore()
    }

    // The project folder itself gets `mkdir`'d eagerly (before any template content is
    // fetched) — the actual regression is about the FILES inside it, never about the root folder.
    assert(
      await Deno.stat(join(projectPath, 'README.md')).then(() => false).catch(() => true),
      'README.md is JSR-tagged and its fetch was stubbed to fail — it must not exist at all, ' +
        'and it must never have been written as an empty (0-byte) file',
    )
    assert(
      await Deno.stat(join(projectPath, 'LICENSE')).then(() => false).catch(() => true),
      'LICENSE must not exist either, for the same reason as README.md above',
    )

    // `Promise.all` (used throughout `createFilesAndFolders`'s own fan-out, recursively) rejects
    // as soon as the FIRST of its promises rejects, without waiting for its still-in-flight
    // siblings (other subfolders' own `Deno.mkdir`/`Deno.writeTextFile` calls, unaffected by the
    // stubbed `fetch` above since they read local disk content) to settle. In the real CLI this is
    // harmless — Cliffy's error handler calls `Deno.exit(1)` the instant `newServerAction`'s
    // promise rejects, which kills every in-flight operation immediately (empirically confirmed —
    // see `commands.new.test.ts`'s real subprocess regression test, which finds zero leftover
    // files at all). Here, in-process, those siblings get a brief window to keep running after
    // `assertRejects` above already resolved, so a plain `Deno.remove` can race a write still
    // landing a file — retried a few times rather than asserted strictly once.
    for (let attempt = 1; true; attempt++) {
      try {
        // deno-lint-ignore no-await-in-loop
        await Deno.remove(root, { recursive: true })
        break
      } catch (error) {
        if (attempt >= 5) throw error
        // deno-lint-ignore no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
      }
    }
  },
)
