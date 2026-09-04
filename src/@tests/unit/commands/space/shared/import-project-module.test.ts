import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import {
  cleanupImportBatch,
  createImportBatchContext,
  importProjectModule,
  readNewestDependencyDate,
  sweepStaleGeneratedModules,
} from 'commands/space/shared/import-project-module.ts'

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

Deno.test(
  "importProjectModule: a bare specifier that also resolves via cli's own config (outside cli's " +
    'own source tree) gets rewritten to the RESOLVED absolute URL, never left as the bare literal',
  async () => {
    // Real, confirmed bug: `resolveReplacement` used to leave a specifier like `@zanix/helpers`
    // (real, in `cli`'s own `imports` map, resolving well outside `cli`'s own hand-written source
    // tree) untouched in the rewritten temp file, "deferring entirely to native resolution" — which
    // only works when the WHOLE running `deno` process happens to share `cli`'s own config (a local
    // checkout). Under a real global `deno install -g jsr:@zanix/cli` install, the process-wide
    // config governing the temp file's own native `import()` has no answer for that bare specifier
    // at all, throwing `Import "@zanix/helpers" not a dependency` on every real invocation. This
    // fixture can't reproduce THAT exact constrained process (this test still runs under `cli`'s
    // own real config, same limitation `getCliLoader`'s own test above documents) — it instead
    // verifies the actual REWRITE happened: the resolved absolute URL landed in the temp file, not
    // the original bare text, which is what makes the fix's guarantee (resolvable with no import
    // map at all) hold regardless of which process ends up running it.
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(join(root, 'deno.json'), '{}\n')
      const entryPath = join(root, 'entry.ts')
      await Deno.writeTextFile(
        entryPath,
        "import { isPlainObject } from '@zanix/helpers'\nexport const value = isPlainObject({})\n",
      )

      const batchContext = createImportBatchContext()
      try {
        const mod = await importProjectModule(entryPath, batchContext)
        assertEquals(
          mod.value,
          true,
          'the real @zanix/helpers import must actually resolve and run',
        )

        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])
        assert(
          !rewritten.includes("'@zanix/helpers'") && !rewritten.includes('"@zanix/helpers"'),
          "the rewritten temp file still contains the bare '@zanix/helpers' specifier — " +
            'resolveReplacement regressed back to deferring to native resolution instead of ' +
            "splicing in the resolved absolute URL (see this test's own doc for why that breaks " +
            'under a real global install).',
        )
        assertStringIncludes(
          rewritten,
          '@zanix/utils',
          'the rewritten temp file should still reference @zanix/utils somewhere, via its ' +
            'resolved absolute URL (@zanix/helpers is a subpath of @zanix/utils on JSR), not have ' +
            'dropped the import entirely',
        )
      } finally {
        await cleanupImportBatch(batchContext)
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'readNewestDependencyDate: a numeric "minimumDependencyAge" (minutes) becomes a cutoff ' +
    'that many minutes before now',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const configPath = join(root, 'deno.json')
      await Deno.writeTextFile(configPath, '{"minimumDependencyAge": 120}\n')

      const before = Date.now()
      const result = readNewestDependencyDate(configPath)
      const after = Date.now()

      assert(result, 'a numeric minimumDependencyAge must produce a real cutoff Date')
      // Bounded rather than an exact equality check, since real wall time elapses between reading
      // `before`/`after` and the function's own `Date.now()` call.
      assert(
        result.getTime() >= before - 120 * 60_000 - 1000 &&
          result.getTime() <= after - 120 * 60_000 + 1000,
        `expected a cutoff ~120 minutes before now, got ${result.toISOString()}`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'readNewestDependencyDate: "minimumDependencyAge": 0 (the real, confirmed-in-production shape ' +
    'aeratech-console\'s own deno.json uses) resolves to effectively "right now" — every ' +
    'already-published dependency version passes',
  async () => {
    // Real, confirmed bug this locks in: `@deno/loader`'s own config-file discovery never
    // translates this field on its own — a project's own "minimumDependencyAge": 0 had zero
    // effect on a Workspace constructed from its configPath alone, before this function existed,
    // still rejecting a same-day-published dependency with Deno's own default 24h window.
    const root = await Deno.makeTempDir()
    try {
      const configPath = join(root, 'deno.json')
      await Deno.writeTextFile(configPath, '{"minimumDependencyAge": 0}\n')

      const before = Date.now()
      const result = readNewestDependencyDate(configPath)
      const after = Date.now()

      assert(
        result,
        '"minimumDependencyAge": 0 must still produce a real cutoff Date, not undefined',
      )
      assert(
        result.getTime() >= before && result.getTime() <= after,
        `expected a cutoff at ~now, got ${result.toISOString()}`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'readNewestDependencyDate: an absolute RFC3339 string is parsed directly as the cutoff',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const configPath = join(root, 'deno.json')
      await Deno.writeTextFile(
        configPath,
        '{"minimumDependencyAge": "2025-09-16T12:00:00+00:00"}\n',
      )

      const result = readNewestDependencyDate(configPath)

      assertEquals(result?.toISOString(), '2025-09-16T12:00:00.000Z')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "readNewestDependencyDate: returns undefined (Deno's own default applies) when configPath is " +
    'undefined, the file has no minimumDependencyAge, or the value is an unrecognized shape',
  async () => {
    assertEquals(readNewestDependencyDate(undefined), undefined)

    const root = await Deno.makeTempDir()
    try {
      const noField = join(root, 'no-field.json')
      await Deno.writeTextFile(noField, '{}\n')
      assertEquals(readNewestDependencyDate(noField), undefined)

      const badShape = join(root, 'bad-shape.json')
      // An ISO-8601 duration string ('P2D') — a real, documented `--min-dep-age` shape this
      // function doesn't handle yet (see its own doc) — must fall back to undefined, not throw.
      await Deno.writeTextFile(badShape, '{"minimumDependencyAge": "P2D"}\n')
      assertEquals(readNewestDependencyDate(badShape), undefined)

      const missingFile = join(root, 'does-not-exist.json')
      assertEquals(readNewestDependencyDate(missingFile), undefined)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
