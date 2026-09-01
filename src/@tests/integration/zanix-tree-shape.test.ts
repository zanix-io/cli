import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { assert, assertEquals, assertExists } from '@std/assert'
import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import { getTemporaryFolder } from '@zanix/helpers'

Deno.test('getZanixPaths should return correct folder structure for server type', () => {
  const paths = getZanixPaths('server')

  assertExists(paths.subfolders)
  assertExists(paths.subfolders['.dist'])
  assertExists(paths.subfolders.src)
  assertExists(paths.subfolders.src.subfolders.server)
  assert(paths.subfolders.src.subfolders['modules' as never] === undefined)
  assert(paths.subfolders.src.subfolders['space' as never] === undefined)
})

Deno.test('getZanixPaths should return correct folder structure for server type custom dir', () => {
  const paths = getZanixPaths('server', 'my-server')

  assertExists(paths.subfolders.src.subfolders.server)
  assert(paths.subfolders.src.subfolders['modules' as never] === undefined)
  assert(paths.subfolders.src.subfolders['space' as never] === undefined)
  assertExists(paths.subfolders.src.subfolders.shared.subfolders.middlewares)
})

Deno.test(
  'getZanixPaths middlewares node: generates example.pipe.ts/example.interceptor.ts locally ' +
    'via planMiddleware — no JSR fetch, the @zanix/core migration (docs/engineering.md §5)',
  async () => {
    const paths = getZanixPaths('server', 'my-server')
    const middlewareFiles =
      paths.subfolders.src.subfolders.shared.subfolders.middlewares.templates.base

    assertEquals(middlewareFiles.length, 2)
    assertEquals(
      middlewareFiles.map((file) => file.NAME).sort(),
      ['example.interceptor.ts', 'example.pipe.ts'],
    )
    assert(
      middlewareFiles.every((file) => !file.PATH.includes('pipe.defs.ts')),
      'the old pipe.defs.ts/interceptor.defs.ts JSR-fetched filenames must be gone',
    )

    // Real proof this no longer depends on `getZanixTemplateContent`'s JSR-fetch machinery: each
    // `content()` resolves to real, non-empty generated source purely locally — no network
    // involved, unlike a `jsr`-tagged node (see `commands/new/lib/tree/base-tree.ts`'s own
    // `createTemplates`).
    for (const file of middlewareFiles) {
      // deno-lint-ignore no-await-in-loop
      const content = await file.content({ metaUrl: import.meta.url })
      assert(content.includes('defineMiddlewareDecorator'), content)
      assert(content.includes('ExamplePipe') || content.includes('ExampleInterceptor'), content)
    }
  },
)

Deno.test('getZanixPaths should return correct folder structure for space custom dir', () => {
  const mainFolderName = 'my-space'
  const paths = getZanixPaths('space', 'my-space')

  assertExists(paths.subfolders.src.subfolders.space)
  assert(paths.FOLDER.startsWith(mainFolderName))
  assert(paths.subfolders.src.FOLDER.startsWith(mainFolderName))
  assert(
    paths.subfolders.src.subfolders.space.FOLDER.startsWith(mainFolderName),
  )
  assert(paths.subfolders.src.subfolders['server' as never] === undefined)
  assert(paths.subfolders.src.subfolders['modules' as never] === undefined)
  // `space` never boots a `'rest'` server (`bootstrapRemoteApp`/`Zanix.start()` only ever gets
  // `ssr`/other non-`rest` types there) — `shared/middlewares`'s `@Guard`/`@Pipe`/`@Interceptor`
  // examples would be structurally dead code by construction, so a pure `space` project no longer
  // scaffolds this subtree at all. `server`/`space-server` (which DO boot `'rest'`) still get it —
  // see the tests below.
  assert(
    paths.subfolders.src.subfolders.shared.subfolders['middlewares' as never] === undefined,
  )
})

Deno.test('getZanixPaths should return correct folder tree for app type custom dir', () => {
  const paths = getZanixPaths('app', 'my-app')

  // Same reasoning as `space` above — an `app` package is composed by a consumer, never itself
  // booting a `'rest'` server, so `shared/middlewares` is dead scaffolding for it too.
  assert(
    paths.subfolders.src.subfolders.shared.subfolders['middlewares' as never] === undefined,
  )
})

Deno.test('getZanixPaths should return correct folder tree for library type custom dir', () => {
  const paths = getZanixPaths('library', 'my-library')

  assertExists(paths.subfolders.src.subfolders.modules)
  assertEquals(paths.subfolders.src.subfolders.shared.subfolders, {})
  assert(paths.subfolders.src.subfolders['server' as never] === undefined)
  assert(paths.subfolders.src.subfolders['space' as never] === undefined)
})

Deno.test('getZanixPaths should return correct folder tree for all type custom dir', () => {
  const paths = getZanixPaths('all', 'my-project')

  assertExists(paths.subfolders.src.subfolders.modules)
  assertExists(paths.subfolders.src.subfolders.server)
  assertExists(paths.subfolders.src.subfolders.space)
  assertExists(paths.subfolders.src.subfolders.shared.subfolders.middlewares)
})

Deno.test('getZanixPaths should return correct folder tree for spacecraft type custom dir', () => {
  const paths = getZanixPaths('space-server', 'my-new-project')

  assertExists(paths.subfolders.src.subfolders.server)
  assertExists(paths.subfolders.src.subfolders.space)
  assertExists(paths.subfolders.src.subfolders.shared.subfolders.middlewares)
  assert(paths.subfolders.src.subfolders['modules' as never] === undefined)
})

Deno.test(
  'getZanixPaths should return correct folder and content tree wihtout root uri',
  async () => {
    const paths = getZanixPaths('library', '')

    const content = await paths.templates.base[0].content({
      metaUrl: import.meta.url,
      relativePath: '../../../',
    })

    assert(content !== '')

    assertEquals(paths.FOLDER, '/')
  },
)

Deno.test(
  'zanix tree content class should return correct content',
  async () => {
    // `getTemporaryFolder` creates `__tmp__` as a sibling of this test file, so a `relativePath`
    // of `__tmp__` is exactly what `content()`'s local-path resolution needs — self-contained,
    // not coupled to any repo's own `src/templates/` layout.
    const tempFolder = getTemporaryFolder(import.meta.url)
    await Deno.writeTextFile(
      `${tempFolder}/example.ts`,
      'export default module',
    )

    try {
      // deno-lint-ignore no-explicit-any
      const tree = ZanixTree.create<any>(tempFolder, {
        templates: { base: { files: ['example.ts'] } },
      })

      const content = await tree.templates.base[0].content({
        metaUrl: import.meta.url,
        relativePath: '__tmp__',
      })

      assertEquals(content, 'export default module')
    } finally {
      await Deno.remove(`${tempFolder}/example.ts`)
    }
  },
)
