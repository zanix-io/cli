import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'

/**
 * `zanix space build`'s own message-compilation step — wiring only. The compiler's own behavior
 * (fail-fast per catalog, isolation across files, mixed catalogs, the exact AST shape) is
 * `compile-messages.test.ts`'s job; this file only proves the command calls it correctly, at the
 * right time, respecting `--no-messages`.
 *
 * @module
 */

const temporaryFolder = getTemporaryFolder(import.meta.url)

type ActionCommand = {
  actionHandler: (options: Record<string, unknown>) => void | Promise<void>
}

async function withMessagesProject(
  messages: { home: unknown },
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: temporaryFolder })
  const originalCwd = Deno.cwd()
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ zanix: { project: 'space' } }, null, 2),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'test-app',
  routesDir: './routes',
  messagesDir: './messages',
})
`,
    )
    await Deno.mkdir(join(root, 'routes'), { recursive: true })
    await Deno.writeTextFile(
      join(root, 'routes', 'page.tsx'),
      `import { Page, SpacePageController } from '@zanix/space'

function HomeView() { return <h1>Home</h1> }

@Page()
export default class HomePage extends SpacePageController {
  static head = { title: 'Home' }
  component = HomeView
}
`,
    )
    await Deno.mkdir(join(root, 'messages', 'en'), { recursive: true })
    await Deno.writeTextFile(
      join(root, 'messages', 'en', 'index.json'),
      JSON.stringify(messages.home),
    )

    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await Deno.remove(root, { recursive: true })
  }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceBuildCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

// This ONE test deliberately runs FIRST in this file, before any other test here declares
// `messagesDir` — `getMessagesDir()`'s own registry is a `@zanix/space`-module-level singleton
// (eager by design, see that package's own `messages-registry.ts`), shared across every
// `Deno.test` in this ONE file/process (Deno isolates module state per FILE, not per `Deno.test`).
// `defineSpaceApp()` only ever WRITES to it when `messagesDir` is actually given, so a later test
// in this file that omits it would otherwise observe whatever an EARLIER test in this same file
// last set — a real production `zanix space build` never has this problem (one process per
// invocation), only this file's own multi-test sequencing does.
Deno.test(
  'zanix space build: a project with no messagesDir configured never touches the filesystem for ' +
    'messages at all',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const originalCwd = Deno.cwd()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ zanix: { project: 'space' } }, null, 2),
      )
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({ name: 'test-app', routesDir: './routes' })
`,
      )
      Deno.chdir(root)

      const command = registerCommand()
      // Completes normally — no messagesDir means the compile step is a pure no-op, never an error
      // about a missing directory.
      await command.actionHandler({})
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'zanix space build: compiles a configured messagesDir to AST, in place, by default',
  async () => {
    await withMessagesProject(
      { home: { title: 'Welcome', greet: 'Hello, {name}!' } },
      async (root) => {
        const command = registerCommand()
        await command.actionHandler({})

        const path = join(root, 'messages', 'en', 'index.json')
        const compiled = JSON.parse(await Deno.readTextFile(path))
        // Compiled: every value is now an AST array, never the original ICU string.
        assert(Array.isArray(compiled.title), `expected AST, got: ${JSON.stringify(compiled)}`)
        assert(Array.isArray(compiled.greet))
        assertEquals(compiled.title, [{ type: 0, value: 'Welcome' }])
      },
    )
  },
)

Deno.test(
  'zanix space build: --no-messages leaves a configured messagesDir untouched',
  async () => {
    await withMessagesProject({ home: { title: 'Welcome' } }, async (root) => {
      const command = registerCommand()
      await command.actionHandler({ messages: false })

      const path = join(root, 'messages', 'en', 'index.json')
      const raw = JSON.parse(await Deno.readTextFile(path))
      assertEquals(raw, { title: 'Welcome' })
    })
  },
)

Deno.test(
  'zanix space build: a broken message catalog fails the WHOLE build — no client output, no ' +
    'partially-compiled catalog left behind',
  async () => {
    await withMessagesProject({ home: { title: 'Hello, {name' } }, async (root) => {
      const command = registerCommand()
      let thrown: unknown
      try {
        await command.actionHandler({})
      } catch (error) {
        thrown = error
      }
      assert(thrown, 'expected the build to fail on an invalid ICU message')
      assert(
        (thrown as Error).message.includes('title'),
        `expected the broken key named in the error: ${(thrown as Error).message}`,
      )

      // The source catalog is untouched — the compiler never writes on a tree-level failure.
      const raw = JSON.parse(
        await Deno.readTextFile(join(root, 'messages', 'en', 'index.json')),
      )
      assertEquals(raw, { title: 'Hello, {name' })

      // The client build never ran either — this is a hard, whole-command failure, not "compile
      // failed but the rest of the build still shipped".
      const outDirExists = await Deno.stat(join(root, 'dist', 'client')).then(() => true).catch(
        () => false,
      )
      assert(!outDirExists, 'expected the client build to never have started')
    })
  },
)
