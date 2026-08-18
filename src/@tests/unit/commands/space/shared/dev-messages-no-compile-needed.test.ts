import { assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { defineSpaceApp, loadMessages } from '@zanix/space'
import { setDevClientEnabled } from '@zanix/space/dev'
import { createFormatter } from '@zanix/space-ui'

/**
 * Proves the claim `compile-messages.ts`'s own module doc makes: `zanix space dev` needs NO
 * compilation step, NO watcher of its own, and no manual cache-clear — editing
 * `messages/en/index.json` while dev is running is reflected on the very next `loadMessages()` +
 * `createFormatter()` call, using mechanisms that already existed before this feature
 * (`loadMessages()`'s own dev-mode cache bypass) and `createFormatter()`'s own pre-existing
 * string/AST duality. Nothing new was built for this — this test is the evidence that nothing
 * needed to be.
 *
 * `@zanix/space-ui` is imported via the same TEMP local path override `compile-messages-space-ui
 * .test.ts` already uses.
 *
 * @module
 */

Deno.test(
  'dev mode: editing a message catalog on disk while dev is running is reflected on the very ' +
    'next request — no compile step, no restart, no manual flow',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await Deno.mkdir(`${dir}/en`, { recursive: true })
      await Deno.writeTextFile(
        `${dir}/en/index.json`,
        JSON.stringify({ greet: 'Hello, {name}!' }),
      )

      // Same eager registration `getMessagesDir()`'s own doc describes — no `zanix space build`
      // step involved anywhere in this test.
      defineSpaceApp({ name: 'dev-proof', messagesDir: dir })
      setDevClientEnabled(true)
      try {
        const first = await loadMessages({ lang: 'en' })
        assertEquals(
          createFormatter('en', first).formatMessage('greet', { name: 'Ada' }),
          'Hello, Ada!',
        )

        // Simulates a developer editing the file by hand while `znx space dev` is running —
        // nothing here compiles it, restarts anything, or clears a cache manually.
        await Deno.writeTextFile(
          `${dir}/en/index.json`,
          JSON.stringify({ greet: 'Hi there, {name}!' }),
        )

        const second = await loadMessages({ lang: 'en' })
        assertEquals(
          createFormatter('en', second).formatMessage('greet', { name: 'Ada' }),
          'Hi there, Ada!',
        )
      } finally {
        setDevClientEnabled(false)
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
