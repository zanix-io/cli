import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceBuildCommand } from 'commands/space/build/command.ts'
import { SPACE_CLIENT_IMPORTS } from './space-client-imports.ts'

/**
 * `zanix space build`'s own GraphQL check step — wiring only (the check's own logic is
 * `graphql-check.test.ts`'s/`graphql-check-schema.test.ts`'s job). Every fixture here is a real,
 * unmodified `space` project with no local server half — `getSchema()` always resolves `undefined`
 * for it (see `graphql-check.ts`'s own module doc), so Layer 2 never activates; these tests only
 * prove Layer 1 (syntax) is wired in at the right time, with the right default, and that
 * `--no-graphql-check` really disables the whole step.
 *
 * @module
 */

const temporaryFolder = getTemporaryFolder(import.meta.url)

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => void | Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceBuildCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

async function withGqlProject(
  gqlContent: string,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: temporaryFolder })
  const originalCwd = Deno.cwd()
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify(
        { zanix: { project: 'space' }, imports: SPACE_CLIENT_IMPORTS },
        null,
        2,
      ),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({ name: 'test-app', routesDir: './routes' })
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
    await Deno.mkdir(join(root, 'gql'), { recursive: true })
    await Deno.writeTextFile(join(root, 'gql', 'users.gql.ts'), gqlContent)

    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'zanix space build: a gql/ directory with only syntactically valid queries never fails the ' +
    'build — a pure space project has no local Application, so Layer 2 never activates either',
  async () => {
    await withGqlProject(
      `export const GET_USER = 'query { user { id name } }'\n`,
      async () => {
        const command = registerCommand()
        // Completes normally.
        await command.settings.actionHandler({})
      },
    )
  },
)

Deno.test(
  'zanix space build: a broken query in gql/ fails the WHOLE build with a clear message naming ' +
    'the file and export',
  async () => {
    await withGqlProject(
      `export const BROKEN_QUERY = 'query ( {'\n`,
      async () => {
        const command = registerCommand()
        let thrown: unknown
        try {
          await command.settings.actionHandler({})
        } catch (error) {
          thrown = error
        }
        assert(thrown, 'expected the build to fail on invalid GraphQL syntax')
        const message = (thrown as Error).message
        assert(message.includes('BROKEN_QUERY'), `expected the broken export named: ${message}`)
        assert(message.includes('users.gql.ts'), `expected the broken file named: ${message}`)
      },
    )
  },
)

Deno.test(
  '--no-graphql-check disables the whole check — a build that would otherwise fail on a broken ' +
    'query succeeds instead',
  async () => {
    await withGqlProject(
      `export const BROKEN_QUERY = 'query ( {'\n`,
      async (root) => {
        const command = registerCommand()
        await command.settings.actionHandler({ graphqlCheck: false })

        // The build actually ran to completion — real proof the check was skipped, not just that
        // nothing threw.
        const outDirExists = await Deno.stat(join(root, '.dist', 'client')).then(() => true).catch(
          () => false,
        )
        assert(outDirExists, 'expected the client build to have run to completion')
      },
    )
  },
)

Deno.test(
  'zanix space build: a project with no gql/ directory at all is completely unaffected — 0 ' +
    'regressions for every existing project that never adopted this convention',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const originalCwd = Deno.cwd()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify(
          { zanix: { project: 'space' }, imports: SPACE_CLIENT_IMPORTS },
          null,
          2,
        ),
      )
      await Deno.writeTextFile(
        join(root, 'space.app.ts'),
        `import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({ name: 'test-app', routesDir: './routes' })
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
      Deno.chdir(root)

      const command = registerCommand()
      await command.settings.actionHandler({})

      const outDirExists = await Deno.stat(join(root, '.dist', 'client')).then(() => true).catch(
        () => false,
      )
      assertEquals(outDirExists, true)
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(root, { recursive: true })
    }
  },
)
