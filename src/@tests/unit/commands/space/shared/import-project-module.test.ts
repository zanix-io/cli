import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { sweepStaleGeneratedModules } from 'commands/space/shared/import-project-module.ts'

// Deliberately a PLAIN `Deno.makeTempDir()` below, never this repo's own `getTemporaryFolder`
// convention (`__tmp__` nested under `src/@tests/...`) — every fixture here simulates a REAL
// consuming project's own root, which is never itself nested inside a directory literally named
// `__tmp__`/`@tests`. Using that convention here was a real, confirmed footgun: `NEVER_REAL_SOURCE`
// (`import-project-module.ts`) tests each entry's own FULL path, which — for a fixture built under
// THIS repo's own `src/@tests/.../__tmp__/` — already contains a matching segment in `root`'s own
// ancestry, before the sweep ever reaches a single real fixture file. A plain system temp dir has
// no such ancestry to collide with.

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false)
}

Deno.test(
  'sweepStaleGeneratedModules: removes a real orphaned .zanix-import-*.js file, wherever it sits ' +
    'in the project tree — real gap found and fixed: nothing else ever revisits one of these once ' +
    'the process that wrote it is killed (Ctrl+C, a crash) before its own `finally` cleanup runs, ' +
    'since a fresh random UUID names each one. Confirmed as a real, live problem before this ' +
    'function existed: four genuine orphans, from earlier killed sessions, found sitting in a ' +
    "real consumer project's own src/ tree.",
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const nested = join(root, 'src', 'auth')
      await Deno.mkdir(nested, { recursive: true })
      const orphan = join(nested, '.zanix-import-11111111-1111-1111-1111-111111111111.js')
      await Deno.writeTextFile(orphan, 'export default {}\n')
      assert(await exists(orphan), 'the fixture itself must exist before sweeping')

      await sweepStaleGeneratedModules(root)

      assertEquals(await exists(orphan), false)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: removes MULTIPLE orphans across different directories in one pass',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const routesDir = join(root, 'src', 'space', 'routes')
      const authDir = join(root, 'src', 'auth')
      await Deno.mkdir(routesDir, { recursive: true })
      await Deno.mkdir(authDir, { recursive: true })
      const orphans = [
        join(routesDir, '.zanix-import-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.js'),
        join(routesDir, '.zanix-import-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.js'),
        join(authDir, '.zanix-import-cccccccc-cccc-cccc-cccc-cccccccccccc.js'),
      ]
      await Promise.all(orphans.map((orphan) => Deno.writeTextFile(orphan, 'export default {}\n')))

      await sweepStaleGeneratedModules(root)

      const stillExist = await Promise.all(orphans.map((orphan) => exists(orphan)))
      stillExist.forEach((found, i) => assertEquals(found, false, orphans[i]))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "sweepStaleGeneratedModules: removes an orphan sitting directly at the project's own root — " +
    "space.app.ts's own real sibling shape, never nested",
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const orphan = join(root, '.zanix-import-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.js')
      await Deno.writeTextFile(orphan, 'export default {}\n')

      await sweepStaleGeneratedModules(root)

      assertEquals(await exists(orphan), false)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: scoped to root (shallow) + src/ (recursive) — a project directory ' +
    'OUTSIDE both (e.g. docs/) never gets walked at all, the accepted tradeoff for skipping ' +
    'node_modules/.git/... without a whole-tree skip list',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const docsDir = join(root, 'docs')
      await Deno.mkdir(docsDir, { recursive: true })
      const orphan = join(docsDir, '.zanix-import-ffffffff-ffff-ffff-ffff-ffffffffffff.js')
      await Deno.writeTextFile(orphan, 'export default {}\n')

      await sweepStaleGeneratedModules(root)

      assert(
        await exists(orphan),
        "a file outside both root-level and src/ is out of this sweep's accepted scope",
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: never touches a real project file, only the exact ' +
    '.zanix-import-*.js shape',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const realFile = join(root, 'space.app.ts')
      await Deno.writeTextFile(realFile, 'export default {}\n')
      // A real file that merely CONTAINS the prefix as a substring, not as its own filename shape
      // — must survive too; the match is anchored to the real generated-file shape, not a loose
      // substring search.
      const lookalike = join(root, 'my.zanix-import-notes.md')
      await Deno.writeTextFile(lookalike, '# notes\n')

      await sweepStaleGeneratedModules(root)

      assert(await exists(realFile), 'a real project file must survive the sweep')
      assert(await exists(lookalike), 'a same-prefix, different-shape file must survive too')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: never walks into a node_modules nested under src/ — nothing in ' +
    'there is ever a real target this pattern could legitimately reach, and walking it would ' +
    "only cost time. Deliberately placed under src/, not at the project root: root's own scan is " +
    'shallow (maxDepth 1) and would never reach this deep regardless of the skip list — this is ' +
    'the one placement that actually exercises NEVER_REAL_SOURCE, not just the shallow root scope.',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const insideNodeModules = join(root, 'src', 'node_modules', 'some-pkg')
      await Deno.mkdir(insideNodeModules, { recursive: true })
      const orphan = join(
        insideNodeModules,
        '.zanix-import-dddddddd-dddd-dddd-dddd-dddddddddddd.js',
      )
      await Deno.writeTextFile(orphan, 'export default {}\n')

      await sweepStaleGeneratedModules(root)

      // Not removed — proves the skip actually took effect, rather than merely happening to leave
      // it alone for some other reason (e.g. the match itself failing).
      assert(await exists(orphan), 'a file under node_modules must never be touched by this sweep')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: never walks into coverage/__tmp__/.dist/.vite/@tests either, when ' +
    "nested under src/ — the same full 'never real source' list ignore.base already establishes, " +
    'not just node_modules, since any of these can be genuinely large on a real project (or, for ' +
    "__tmp__/@tests, a real consuming project's OWN test-tier fixtures, per " +
    'naming-and-structure-conventions). Placed under src/, same reasoning as the node_modules ' +
    "test above — root's own shallow scan would never reach these regardless.",
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const heavyDirs = ['coverage', '__tmp__', '.dist', '.vite', 'dist-ssr', 'vendor', '@tests']
      const orphans = heavyDirs.map((dirName) => {
        const dir = join(root, 'src', dirName, 'nested')
        Deno.mkdirSync(dir, { recursive: true })
        const orphan = join(dir, `.zanix-import-${crypto.randomUUID()}.js`)
        Deno.writeTextFileSync(orphan, 'export default {}\n')
        return orphan
      })

      await sweepStaleGeneratedModules(root)

      const survived = await Promise.all(orphans.map((orphan) => exists(orphan)))
      survived.forEach((found, i) =>
        assert(found, `must never be touched by this sweep: ${orphans[i]}`)
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: a project with no orphans at all is a real, harmless no-op',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(join(root, 'space.app.ts'), 'export default {}\n')

      // Must not throw.
      await sweepStaleGeneratedModules(root)

      assert(await exists(join(root, 'space.app.ts')))
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'sweepStaleGeneratedModules: a genuinely unreadable root never throws — best-effort cleanup, ' +
    'never something that should fail zanix space dev/build itself over this',
  async () => {
    // A root that never existed at all — the walk itself fails outright, not just an individual
    // file's own removal.
    await sweepStaleGeneratedModules('/this/path/genuinely/does/not/exist/anywhere')
  },
)

Deno.test(
  "getCliLoader's own fromFileUrl(import.meta.url) call is guarded by a file:// scheme check, " +
    'never called unconditionally',
  async () => {
    // Real, confirmed bug: `getCliLoader()` used to call `fromFileUrl(import.meta.url)`
    // unconditionally — throwing `Must be a file URL` the instant `@zanix/cli` itself loads via
    // `jsr:` (this module's own `import.meta.url` is `https://jsr.io/...` there, not `file://`),
    // which is exactly what a real global install (`deno install -g jsr:@zanix/cli`) does. No unit
    // test can exercise the actual runtime branch this fixes — `import.meta.url` is fixed per
    // module instance, so a `deno test` run here can never observe it as anything but `file://` —
    // so this parses the raw source text instead (same technique
    // `lazy-command-specifiers-relative.test.ts` uses for the sibling bug class) and fails loud if
    // `fromFileUrl(import.meta.url)` (inside `getCliLoader`) is ever called without a preceding
    // scheme guard.
    const source = await Deno.readTextFile(
      new URL('../../../../../commands/space/shared/import-project-module.ts', import.meta.url),
    )
    const fnMatch = source.match(
      /function getCliLoader\(\)[\s\S]*?\n\}/,
    )
    assert(
      fnMatch,
      "getCliLoader's own declaration could not be found — did it move or get renamed?",
    )

    const body = fnMatch[0]
    assert(
      /import\.meta\.url\.startsWith\(\s*(['"])file:\/\/\1\s*\)/.test(body),
      'getCliLoader() no longer guards its fromFileUrl(import.meta.url) call with a ' +
        "file:// scheme check — this regresses back to throwing 'Must be a file URL' the moment " +
        "@zanix/cli loads via jsr: (see this test's own doc for the full account).",
    )
  },
)
