import { assert, assertEquals } from '@std/assert'
import { getTemporaryFolder } from '@zanix/helpers'
import { importSpaceApp } from 'commands/space/shared/import-space-app.ts'

// deno-lint-ignore no-explicit-any
type FakeCommander = { throw: (e: any) => void }

const TMP_ROOT = getTemporaryFolder(import.meta.url)

// `command-renderer.test.ts` (under `space/build`) already covers the real, valid `space.app.ts`
// happy path through this same function. Neither error branch is exercised anywhere else.

Deno.test(
  'importSpaceApp should route a real import failure through cwd.throw',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    // Deliberately no `space.app.ts` written — the real `import()` below fails to resolve.
    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await importSpaceApp(fakeCommander as never, root).catch(() => {})

      assert(thrown, 'expected cwd.throw to have been called')
      assert((thrown as Error).message.includes("Could not import 'space.app.ts'"))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "importSpaceApp resolves a bare specifier declared ONLY in the project's own deno.json — never " +
    "declared anywhere in @zanix/cli's own configuration — proving space.app.ts's own bare " +
    "specifiers resolve against the PROJECT's config, not cli's",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        zanix: { project: 'space' },
        imports: {
          '@zanix/space': 'jsr:@zanix/space@^0.3.2',
          // A local alias @zanix/cli's own deno.jsonc has never heard of — the real bug this
          // whole fix closes: a plain `import()` from inside `cli`'s own process would fail this
          // outright with "not a dependency and not in import map".
          '@acme/test-marker-xyz': './marker.ts',
        },
      }),
    )
    await Deno.writeTextFile(`${root}/marker.ts`, `export const marker = 'resolved-for-real'\n`)
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      `import { defineSpaceApp } from '@zanix/space'
import { marker } from '@acme/test-marker-xyz'

export default defineSpaceApp({ name: \`app-\${marker}\`, routesDir: './routes' })
`,
    )
    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      const app = await importSpaceApp(fakeCommander as never, root)
      assertEquals(thrown, undefined)
      assertEquals(app.definition.name, 'app-resolved-for-real')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'importSpaceApp honors a project\'s own "links" override for an unpublished local checkout — ' +
    "resolving through the project's own real @deno/loader Workspace picks up the LINKED " +
    'directory, never the published range the project also declares',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    const linkedDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const linkedName = `../${linkedDir.split('/').pop()}`

    await Deno.writeTextFile(
      `${linkedDir}/deno.json`,
      JSON.stringify({ name: '@acme/linked-marker-xyz', version: '9.9.9', exports: './mod.ts' }),
    )
    await Deno.writeTextFile(
      `${linkedDir}/mod.ts`,
      `export const marker = 'from-the-local-linked-checkout'\n`,
    )
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        zanix: { project: 'space' },
        links: [linkedName],
        // Deliberately no `imports` entry for `@acme/linked-marker-xyz` — `links` resolves a bare
        // specifier through the linked directory's own declared `name` on its own; adding an
        // explicit `imports` entry alongside it would instead pin a real semver range, which
        // `links` does not override (a real, separate mechanism from a raw relative-path `imports`
        // override).
        imports: { '@zanix/space': 'jsr:@zanix/space@^0.3.2' },
      }),
    )
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      `import { defineSpaceApp } from '@zanix/space'
import { marker } from '@acme/linked-marker-xyz'

export default defineSpaceApp({ name: \`app-\${marker}\`, routesDir: './routes' })
`,
    )
    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      const app = await importSpaceApp(fakeCommander as never, root)
      assertEquals(thrown, undefined)
      assertEquals(app.definition.name, 'app-from-the-local-linked-checkout')
    } finally {
      await Deno.remove(root, { recursive: true })
      await Deno.remove(linkedDir, { recursive: true })
    }
  },
)

Deno.test(
  'importSpaceApp should route an invalid default export through cwd.throw',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      'export default { notAZanixAppDefinition: true }\n',
    )
    let thrown: unknown
    const fakeCommander: FakeCommander = {
      throw: (e) => {
        thrown = e
      },
    }

    try {
      await importSpaceApp(fakeCommander as never, root).catch(() => {})

      assert(thrown, 'expected cwd.throw to have been called')
      assertEquals(
        (thrown as Error).message.includes('must have a default export from defineSpaceApp()'),
        true,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
