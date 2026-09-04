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
  "importSpaceApp resolves a project's own 'utils/' alias against the PROJECT's own src/utils/, " +
    "never against @zanix/cli's OWN 'utils/' alias — even though cli's own deno.jsonc declares " +
    "the IDENTICAL alias name (the exact scaffold convention 'zanix new' seeds into every real " +
    'project), and cli genuinely has a real, existing utils/commands.ts of its own at the SAME ' +
    'relative subpath (proving this is a real collision, not a contrived name). Reached through a ' +
    'relatively-imported file — never space.app.ts itself — matching the real reported shape ' +
    "(a project's own interactor bare-importing 'utils/constants.ts')",
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        zanix: { project: 'space' },
        imports: {
          '@zanix/space': 'jsr:@zanix/space@^0.3.2',
          // Same alias NAME cli's own deno.jsonc declares (`"utils/": "./src/utils/"`) — pointing
          // at THIS project's own utils folder, never cli's.
          'utils/': './src/utils/',
        },
      }),
    )
    await Deno.mkdir(`${root}/src/utils`, { recursive: true })
    // `commands.ts` specifically — a real file that already exists under cli's OWN `src/utils/`
    // too, so cli's own loader resolves this exact specifier successfully (never throws), which
    // is what actually exercises the false-positive branch this test guards. A name with no real
    // counterpart in cli's own `src/utils/` would only exercise the unrelated "cli's config has
    // no answer at all" fallback path, already covered above.
    await Deno.writeTextFile(
      `${root}/src/utils/commands.ts`,
      `export const marker = 'project-owned-utils-commands'\n`,
    )
    await Deno.writeTextFile(
      `${root}/interactor.ts`,
      `export { marker } from 'utils/commands.ts'\n`,
    )
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      `import { defineSpaceApp } from '@zanix/space'
import { marker } from './interactor.ts'

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
      // If this ever resolves against cli's OWN `src/utils/commands.ts` again, `marker` is not
      // exported there at all — either a thrown "does not provide an export named 'marker'"
      // (`thrown` above would catch that) or, depending on the loader's own real interop
      // behavior, a silently `undefined` value baked into the name below. Either way, this exact
      // string only comes out the other end when the PROJECT's own file was the one loaded.
      assertEquals(app.definition.name, 'app-project-owned-utils-commands')
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
  'importSpaceApp resolves a real *.module.css import reached through a relative import — a ' +
    "Comet's own CSS Modules import must not crash native import() with Deno's own " +
    '"Expected a JavaScript or TypeScript module" (CSS stub regression)',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        zanix: { project: 'space' },
        imports: { '@zanix/space': 'jsr:@zanix/space@^0.3.2' },
      }),
    )
    await Deno.writeTextFile(`${root}/styles.module.css`, '.button { color: red; }\n')
    await Deno.writeTextFile(
      `${root}/comet.ts`,
      `import styles from './styles.module.css'\nexport const marker = typeof styles\n`,
    )
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      `import { defineSpaceApp } from '@zanix/space'
import { marker } from './comet.ts'

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
      // `typeof {}` — a real, non-crashing default export, never the raw CSS file's own path
      // handed to native `import()` unchanged (which throws before this point).
      assertEquals(app.definition.name, 'app-object')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'importSpaceApp resolves a real *.json import reached through a relative import with its ACTUAL ' +
    'content, never an empty stub (JSON stub regression)',
  async () => {
    const root = await Deno.makeTempDir({ dir: TMP_ROOT })
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        zanix: { project: 'space' },
        imports: { '@zanix/space': 'jsr:@zanix/space@^0.3.2' },
      }),
    )
    await Deno.writeTextFile(`${root}/data.json`, JSON.stringify({ label: 'from-json' }))
    await Deno.writeTextFile(
      `${root}/space.app.ts`,
      `import { defineSpaceApp } from '@zanix/space'
import data from './data.json'

export default defineSpaceApp({ name: \`app-\${data.label}\`, routesDir: './routes' })
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
      assertEquals(app.definition.name, 'app-from-json')
    } finally {
      await Deno.remove(root, { recursive: true })
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
