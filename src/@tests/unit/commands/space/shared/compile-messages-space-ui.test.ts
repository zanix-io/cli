import { assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { createFormatter } from '@zanix/space-ui'
import { compileCatalog, compileMessagesTree } from 'commands/space/shared/compile-messages.ts'

/**
 * Proves this compiler's real output is directly consumable by `@zanix/space-ui`'s own
 * `createFormatter` — not a `MessageFormatElement[]` shape that's theoretically correct but
 * incompatible with the actual consumer. `@zanix/space-ui` is imported here via a TEMP local path
 * override (`deno.jsonc`'s own `imports` — same precedent as `@zanix/space`'s own three entries),
 * not yet a real JSR dependency.
 *
 * @module
 */

async function writeJson(path: string, content: unknown): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, JSON.stringify(content))
}

Deno.test(
  'compileCatalog output → createFormatter: a plain message formats correctly',
  () => {
    const compiled = compileCatalog({ 'home/title': 'Welcome' })
    const { formatMessage } = createFormatter('en', compiled)
    assertEquals(formatMessage('home/title'), 'Welcome')
  },
)

Deno.test(
  'compileCatalog output → createFormatter: interpolation formats correctly',
  () => {
    const compiled = compileCatalog({ greet: 'Hello, {name}!' })
    const { formatMessage } = createFormatter('en', compiled)
    assertEquals(formatMessage('greet', { name: 'Ada' }), 'Hello, Ada!')
  },
)

Deno.test(
  'compileCatalog output → createFormatter: an ICU plural formats correctly',
  () => {
    const compiled = compileCatalog({
      cart: '{count, plural, one {# item} other {# items}}',
    })
    const { formatMessage } = createFormatter('en', compiled)
    assertEquals(formatMessage('cart', { count: 1 }), '1 item')
    assertEquals(formatMessage('cart', { count: 5 }), '5 items')
  },
)

Deno.test(
  'compileMessagesTree output (a real catalog read from disk) → createFormatter: end to end, ' +
    'no glue code needed at the consuming end',
  async () => {
    const dir = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
    try {
      await writeJson(`${dir}/en/index.json`, {
        'home/title': 'Welcome',
        cart: '{count, plural, one {# item} other {# items}}',
      })

      const { compiled, failures } = await compileMessagesTree(dir)
      assertEquals(failures, [])

      const { formatMessage } = createFormatter('en', compiled[`${dir}/en/index.json`])
      assertEquals(formatMessage('home/title'), 'Welcome')
      assertEquals(formatMessage('cart', { count: 3 }), '3 items')
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
