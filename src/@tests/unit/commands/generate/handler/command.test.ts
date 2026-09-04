import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateHandlerAction, { planHandler } from 'commands/generate/handler/command.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(zanixProject: string): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({ zanix: { project: zanixProject } }),
  )
  return projectFolder
}

Deno.test('generateHandlerAction should throw outside a server/space-server project', async () => {
  const projectFolder = await makeProject('library')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateHandlerAction.call(new Commander(), {}, 'user'),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction should write a handler file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateHandlerAction.call(new Commander(), {}, 'UserSettings')

    const handlerPath = `${projectFolder}/src/server/handlers/user-settings.handler.ts`
    const content = await Deno.readTextFile(handlerPath)

    assertEquals(content.includes('export class UserSettingsController'), true)
    assertEquals(
      content.includes("@Controller({ prefix: 'user-settings' })"),
      true,
    )
    assertEquals(content.includes('extends ZanixController'), true)

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/server'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateHandlerAction.call(new Commander(), {}, 'invoice')
    await generateHandlerAction.call(new Commander(), {}, 'invoice')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/handlers/invoice.handler.ts`,
    )
    assertEquals(content.includes('export class InvoiceController'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction should never overwrite an existing handler file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const handlersFolder = `${projectFolder}/src/server/handlers`
  const handlerPath = `${handlersFolder}/invoice.handler.ts`

  try {
    await Deno.mkdir(handlersFolder, { recursive: true })
    await Deno.writeTextFile(handlerPath, '// customized by hand\n')

    await generateHandlerAction.call(new Commander(), {}, 'invoice')

    assertEquals(
      await Deno.readTextFile(handlerPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction --type graphql writes a resolver file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateHandlerAction.call(
      new Commander(),
      { type: 'graphql' },
      'Products',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/handlers/products.resolver.handler.ts`,
    )

    assertEquals(content.includes('export class ProductsResolver'), true)
    assertEquals(content.includes("@Resolver({ prefix: 'products' })"), true)
    assertEquals(content.includes('extends ZanixResolver'), true)
    // `ZanixResolver`/`Resolver`/`Query` live at `@zanix/server`'s own `./graphql` subpath, not the
    // root — see `graphql.template.ts`'s own header doc.
    assertEquals(
      content.includes(
        "import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'",
      ),
      true,
    )
    assertEquals(
      content.includes("import type { HandlerContext } from '@zanix/server'"),
      true,
    )
    // Real dispatch (`graphql/decorators/assembly.ts`'s `handler.call(instance, payload, ctx)`)
    // always invokes `@Query`/`@Mutation` methods with two arguments — the stub must declare both,
    // never just `ctx`, or `ctx` silently receives `payload` instead at runtime.
    assertEquals(
      content.includes(
        'public list(_payload: Record<string, never>, _ctx: HandlerContext) {',
      ),
      true,
    )

    // `--type graphql` also declares the `./graphql` subpath — the resolver's own real imports
    // need it, on top of the plain `@zanix/server` entry every handler type declares.
    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/server/graphql'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/server/graphql'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction --type socket writes a socket file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateHandlerAction.call(
      new Commander(),
      { type: 'socket' },
      'Chat',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/handlers/chat.socket.handler.ts`,
    )

    assertEquals(content.includes('export class ChatSocket'), true)
    assertEquals(content.includes("@Socket('chat')"), true)
    assertEquals(content.includes('extends ZanixWebSocket'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction --type ssr writes an ssr file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateHandlerAction.call(
      new Commander(),
      { type: 'ssr' },
      'Products',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/server/handlers/products.ssr.handler.ts`,
    )

    assertEquals(content.includes('export class ProductsController'), true)
    assertEquals(
      content.includes("@SsrController({ prefix: 'products' })"),
      true,
    )
    assertEquals(content.includes('extends ZanixSsrController'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateHandlerAction should throw clearly for an unsupported --type', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () =>
        generateHandlerAction.call(
          new Commander(),
          { type: 'grpc' },
          'invoice',
        ),
      Error,
      "Unsupported handler type 'grpc'",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planHandler rest returns a single <name>.handler.ts', () => {
  const { files } = planHandler(
    'example',
    'Example',
    'rest',
    '/root/src/server/handlers',
  )

  assertEquals(files.map((f) => f.NAME), ['example.handler.ts'])
})

// Every non-`rest` type's file name must still end in `.handler.ts` — that's the exact real
// `@zanix/server` `ZANIX_SERVER_MODULES` suffix `@zanix/core`'s `defineLocalMetadata` auto-scans
// for (see `HANDLER_TYPES`'s own doc in `command.ts`); a suffix that didn't would silently never
// be auto-discovered, which is exactly the bug `discovery-live.test.ts` (sibling file) guards
// against end-to-end. This unit test only pins the plain planning-level shape/naming.
Deno.test('planHandler graphql/socket/ssr all end in .handler.ts, with distinct prefixes', () => {
  const graphql = planHandler('example', 'Example', 'graphql', '/root/src/server/handlers')
  const socket = planHandler('example', 'Example', 'socket', '/root/src/server/handlers')
  const ssr = planHandler('example', 'Example', 'ssr', '/root/src/server/handlers')

  assertEquals(graphql.files.map((f) => f.NAME), ['example.resolver.handler.ts'])
  assertEquals(socket.files.map((f) => f.NAME), ['example.socket.handler.ts'])
  assertEquals(ssr.files.map((f) => f.NAME), ['example.ssr.handler.ts'])
})

Deno.test('planHandler throws for an unsupported type', () => {
  assertThrows(
    () => planHandler('example', 'Example', 'grpc', '/root/src/server/handlers'),
    Error,
    "Unsupported handler type 'grpc'",
  )
})
