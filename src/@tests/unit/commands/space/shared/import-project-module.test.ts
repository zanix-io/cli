import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import { readNewestDependencyDate } from 'commands/space/shared/deno-config-discovery.ts'
import { cliLoaderHasNoRealLocalAnswer } from 'commands/space/shared/cli-loader.ts'
import { reconstructNpmSpecifierFromResolvedPath } from 'commands/space/shared/specifier-reconstruction.ts'
import { detectTransitiveCollisionPackages } from 'commands/space/shared/transitive-collision.ts'
import {
  defaultGeneratedModuleDirsManifestPath,
  readGeneratedModuleDirsManifest,
  recordGeneratedModuleDir,
} from 'commands/space/shared/generated-module-dirs-manifest.ts'
import {
  cleanupImportBatch,
  createImportBatchContext,
  importProjectModule,
  sweepRegisteredGeneratedModuleDirs,
  sweepStaleGeneratedModules,
} from 'commands/space/shared/import-project-module.ts'

// Deliberately a PLAIN `Deno.makeTempDir()` below, never this repo's own `getTemporaryFolder`
// convention (`__tmp__` nested under `src/@tests/...`) — every fixture here simulates a REAL
// consuming project's own root, which is never itself nested inside a directory literally named
// `__tmp__`/`@tests`. Using that convention here is a real footgun: `NEVER_REAL_SOURCE`
// (`import-project-module.ts`) tests each entry's own FULL path, which — for a fixture built under
// THIS repo's own `src/@tests/.../__tmp__/` — already contains a matching segment in `root`'s own
// ancestry, before the sweep ever reaches a single real fixture file. A plain system temp dir has
// no such ancestry to collide with.

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false)
}

Deno.test(
  'sweepStaleGeneratedModules: removes a real orphaned .zanix-import-*.js file, wherever it sits ' +
    'in the project tree — nothing else ever revisits one of these once the process that wrote it ' +
    'is killed (Ctrl+C, a crash) before its own `finally` cleanup runs, since a fresh random UUID ' +
    'names each one, and orphans genuinely accumulate on disk otherwise: a killed process leaves ' +
    "one sitting in the consumer project's own src/ tree until something sweeps it.",
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
  'recordGeneratedModuleDir + sweepRegisteredGeneratedModuleDirs: reaches a directory entirely ' +
    "outside any served project's own root/src scope — the real gap a linked/workspace sibling's " +
    'own directory falls into (e.g. a raw relative-path deno.json override pointing a package at ' +
    "a local checkout), which sweepStaleGeneratedModules' own structural scan can never see on " +
    "its own, since it only ever looks at paths computed FROM the served project's own root",
  async () => {
    const manifestDir = await Deno.makeTempDir()
    const siblingDir = await Deno.makeTempDir()
    try {
      const manifestPath = join(manifestDir, 'generated-module-dirs.json')
      const orphan = join(siblingDir, '.zanix-import-99999999-9999-9999-9999-999999999999.js')
      await Deno.writeTextFile(orphan, 'export default {}\n')

      await recordGeneratedModuleDir(siblingDir, manifestPath)
      assert(await exists(orphan), 'the fixture itself must exist before sweeping')

      await sweepRegisteredGeneratedModuleDirs(manifestPath)

      assertEquals(await exists(orphan), false)
    } finally {
      await Deno.remove(manifestDir, { recursive: true })
      await Deno.remove(siblingDir, { recursive: true })
    }
  },
)

Deno.test(
  'sweepRegisteredGeneratedModuleDirs: a recorded directory that no longer exists at all is ' +
    'dropped from the manifest — nothing left to ever sweep there again',
  async () => {
    const manifestDir = await Deno.makeTempDir()
    const goneDir = await Deno.makeTempDir()
    try {
      const manifestPath = join(manifestDir, 'generated-module-dirs.json')
      await recordGeneratedModuleDir(goneDir, manifestPath)
      await Deno.remove(goneDir, { recursive: true })

      await sweepRegisteredGeneratedModuleDirs(manifestPath)

      assertEquals(JSON.parse(await Deno.readTextFile(manifestPath)), [])
    } finally {
      await Deno.remove(manifestDir, { recursive: true })
    }
  },
)

Deno.test(
  'sweepRegisteredGeneratedModuleDirs: a recorded directory that still exists stays listed after ' +
    'a sweep — a project that keeps getting killed mid-import keeps getting cleaned up on every ' +
    'later zanix space dev/build run, not just the first one after it was recorded',
  async () => {
    const manifestDir = await Deno.makeTempDir()
    const stillHereDir = await Deno.makeTempDir()
    try {
      const manifestPath = join(manifestDir, 'generated-module-dirs.json')
      await recordGeneratedModuleDir(stillHereDir, manifestPath)

      await sweepRegisteredGeneratedModuleDirs(manifestPath)

      assertEquals(JSON.parse(await Deno.readTextFile(manifestPath)), [stillHereDir])
    } finally {
      await Deno.remove(manifestDir, { recursive: true })
      await Deno.remove(stillHereDir, { recursive: true })
    }
  },
)

Deno.test(
  'sweepRegisteredGeneratedModuleDirs: no manifest file at all yet is a harmless no-op, never a ' +
    'throw — the real shape on the very first zanix space dev/build run this machine has ever done',
  async () => {
    const manifestDir = await Deno.makeTempDir()
    try {
      await sweepRegisteredGeneratedModuleDirs(join(manifestDir, 'does-not-exist.json'))
    } finally {
      await Deno.remove(manifestDir, { recursive: true })
    }
  },
)

Deno.test(
  "getCliConfigPath's own fromFileUrl(import.meta.url) call is guarded by a file:// scheme " +
    'check, never called unconditionally',
  async () => {
    // Verifies `getCliConfigPath()` guards its `fromFileUrl(import.meta.url)` call with a scheme
    // check — an unguarded call throws `Must be a file URL` the instant `@zanix/cli` itself loads
    // via `jsr:` (this module's own `import.meta.url` is `https://jsr.io/...` there, not
    // `file://`), exactly what a real global install (`deno install -g jsr:@zanix/cli`) does. No
    // unit test can exercise that runtime branch directly — `import.meta.url` is fixed per module
    // instance, so a `deno test` run here can never observe it as anything but `file://` — so this
    // parses the raw source text instead (same technique
    // `lazy-command-specifiers-relative.test.ts` uses for the sibling bug class) and fails loud if
    // `fromFileUrl(import.meta.url)` (inside `getCliConfigPath`, the function `getCliLoader` and
    // `prepareTransitiveCollisionReexec` both now share this lazily-computed value through) is
    // ever called without a preceding scheme guard — `isFileUrl` (`@zanix/helpers`), a real `new
    // URL(...)` parse, not a hand-rolled `.startsWith('file://')` check.
    const source = await Deno.readTextFile(
      new URL('../../../../../commands/space/shared/cli-loader.ts', import.meta.url),
    )
    const fnMatch = source.match(
      /export function getCliConfigPath\(\)[\s\S]*?\n\}/,
    )
    assert(
      fnMatch,
      "getCliConfigPath's own declaration could not be found — did it move or get renamed?",
    )

    const body = fnMatch[0]
    assert(
      /isFileUrl\(\s*import\.meta\.url\s*\)/.test(body),
      'getCliConfigPath() no longer guards its fromFileUrl(import.meta.url) call with an ' +
        "isFileUrl() scheme check — this regresses back to throwing 'Must be a file URL' the " +
        "moment @zanix/cli loads via jsr: (see this test's own doc for the full account).",
    )
  },
)

Deno.test(
  "importProjectModule: a bare specifier that also resolves via cli's own config (outside cli's " +
    'own source tree) gets rewritten to the RESOLVED absolute URL, never left as the bare literal',
  async () => {
    // Verifies that `resolveReplacement` rewrites a specifier like `@zanix/helpers` (real, in
    // `cli`'s own `imports` map, resolving well outside `cli`'s own hand-written source tree) to
    // its RESOLVED absolute URL in the rewritten temp file, rather than deferring to native
    // resolution — deferring only works when the WHOLE running `deno` process happens to share
    // `cli`'s own config (a local checkout). Under a real global `deno install -g jsr:@zanix/cli`
    // install, the process-wide config governing the temp file's own native `import()` has no
    // answer for that bare specifier at all, throwing `Import "@zanix/helpers" not a dependency`
    // on every real invocation. This fixture can't reproduce THAT exact constrained process (this
    // test still runs under `cli`'s own real config, same limitation `getCliLoader`'s own test
    // above documents) — it instead verifies the actual REWRITE happens: the resolved absolute URL
    // lands in the temp file, not the original bare text, which is what makes this resolvable with
    // no import map at all, regardless of which process ends up running it.
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
  "importProjectModule: a bare specifier the PROJECT's own config pins to a version that " +
    "genuinely differs from cli's own config resolves to the PROJECT's version, never cli's",
  async () => {
    // `resolveReplacement` tries the PROJECT's own config first — `cli`'s own config (this repo's
    // own `deno.jsonc` declares `@zanix/helpers` as `jsr:@zanix/utils@^4.2.1/helpers`, resolving
    // to the latest matching stable release, `4.4.0` as of this test) only ever answers as a
    // fallback, for a specifier the project's own config has no answer for at all — never as a way
    // to override what the project itself declares. This is the exact shape of a real incident: a
    // project pinning a dependency `cli` also happens to declare, for its own, unrelated reasons,
    // at a genuinely different version.
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { '@zanix/helpers': 'jsr:@zanix/utils@4.3.0/helpers' } }),
      )
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
          "the project's own pinned @zanix/utils@4.3.0/helpers must actually resolve and run",
        )

        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])
        assertStringIncludes(
          rewritten,
          '@zanix/utils/4.3.0/',
          "the rewritten temp file must reference the project's own pinned 4.3.0 — " +
            "resolveReplacement regressed back to letting cli's own, different @zanix/utils range " +
            'win instead.',
        )
        assert(
          !rewritten.includes('/4.4.0/') && !rewritten.includes('@zanix/utils@^4.2.1'),
          "the rewritten temp file must not reference cli's own resolved version " +
            '(4.4.0, or the unexpanded ^4.2.1 range) at all.',
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
  "importProjectModule: a bare specifier the PROJECT's own config pins to an EXACT PRERELEASE " +
    "version resolves to that prerelease, never to cli's own broader, stable-only range",
  async () => {
    // Same guarantee as the previous test, for the shape that actually motivated it: a real
    // consumer project pinning a prerelease of a dependency (e.g. `2.1.0-rc.1`) `cli` also happens
    // to declare, at a range that — per ordinary semver — resolves to the latest matching STABLE
    // release only, silently excluding any prerelease. `@zanix/utils@2.0.3-alpha9` is a real,
    // published prerelease, used here in place of an internal test-only package specifically so
    // this exercises the genuine "does a real registry prerelease pin survive" question, not a
    // synthetic stand-in for one.
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { '@zanix/helpers': 'jsr:@zanix/utils@2.0.3-alpha9/helpers' } }),
      )
      const entryPath = join(root, 'entry.ts')
      // A side-effect-only import — never a named one: which exports `2.0.3-alpha9`'s own
      // `helpers/mod.ts` carries is irrelevant to what this test checks (that the specifier
      // resolves to THIS exact prerelease, not to a stable substitute); asserting on a named
      // export here would couple this test to that old prerelease's own API surface for no reason.
      await Deno.writeTextFile(entryPath, "import '@zanix/helpers'\nexport const value = true\n")

      const batchContext = createImportBatchContext()
      try {
        const mod = await importProjectModule(entryPath, batchContext)
        assertEquals(mod.value, true, "the project's own pinned prerelease must actually resolve")

        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])
        assertStringIncludes(
          rewritten,
          '@zanix/utils/2.0.3-alpha9/',
          "the rewritten temp file must reference the project's own pinned prerelease — " +
            "resolveReplacement regressed back to letting cli's own, stable-only @zanix/utils " +
            'range win instead.',
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
  'importProjectModule: a bare specifier resolving to an UNEXPANDED jsr:/http(s): literal (a bare ' +
    'range, not a real version) gets forced through a real dependency-constraint solve before ' +
    'being spliced into the rewritten temp file — never the raw, unexpanded literal',
  async () => {
    // Verifies that `cliLoader.resolveSync(specifier, ...)`'s own unexpanded literal — e.g.
    // `jsr:@zanix/space@^X.Y.Z`, the raw import-map VALUE, not a real resolved version, for a
    // jsr:/http(s): target — never gets spliced directly into the rewritten temp file: doing so
    // would let native `import()` perform its OWN, separate version-range resolution at runtime,
    // which can land on a DIFFERENT actual version than whatever `cli`'s own static import of the
    // same package resolves to, silently loading a SECOND module instance of a package meant to be
    // a process-wide singleton — `@zanix/space`'s own `SpaceDevSocket`, which registers a route as
    // a top-level side effect, is exactly that case: two instances means two registrations of the
    // same route, throwing "already defined".
    // `@zanix/helpers` (used above) happens to ALSO resolve to an unexpanded literal
    // (`jsr:@zanix/utils@^X.Y.Z/helpers`) but doesn't exercise this distinction on its own — a
    // single, isolated import never conflicts with anything else, so the bug only manifests with a
    // SECOND competing resolution path, which a unit test can't easily construct. This test
    // instead asserts the STRUCTURAL guarantee that prevents it: the rewritten temp file's own
    // specifier is a real, fully-versioned URL, never a bare semver range.
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
        await importProjectModule(entryPath, batchContext)
        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])

        const specifierMatch = rewritten.match(/from\s+(['"])(.+?)\1/)
        assert(specifierMatch, 'expected a real import specifier in the rewritten temp file')
        const resolvedSpecifier = specifierMatch[2]

        assert(
          !/@[\^~]\d/.test(resolvedSpecifier),
          `the rewritten specifier '${resolvedSpecifier}' still carries a bare semver RANGE ` +
            "(e.g. '^X.Y.Z'), not a fully-resolved exact version — resolveReplacement regressed " +
            'back to splicing an unexpanded jsr:/http(s): literal instead of forcing a real ' +
            "dependency-constraint solve first (see this test's own doc for the full account).",
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
  "importProjectModule: a cli-shared bare specifier that resolves into node_modules (react's own " +
    'CJS jsx-runtime shim) gets reconstructed as a scheme specifier, never left as a raw ' +
    'file:// node_modules path',
  async () => {
    // Verifies that the `cliResolved` branch reconstructs a scheme-based specifier rather than
    // splicing a `file://` path straight into node_modules, for a specifier resolving OUTSIDE
    // cli's own source tree: react's own CJS entry (`node_modules/react/jsx-runtime.js`) is a
    // runtime `if (process.env.NODE_ENV === 'production') { ... } else { ... }` conditional
    // `require`, which Deno's static CJS→ESM named-export analysis can't see through — a raw
    // `file://` import of it exposes NO named exports at all, so `import { jsx } from
    // 'react/jsx-runtime'` fails outright even though the file resolves successfully.
    // Reconstructing the scheme-based specifier form (`npm:react@^X.Y.Z/jsx-runtime`) instead
    // hands native `import()` the same text a normal static import would use, with full npm
    // CJS/ESM interop intact — mirroring the identical mechanism the project-anchored
    // `node_modules` branch further down in `resolveReplacement` already has, for the exact same
    // reason.
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(join(root, 'deno.json'), '{}\n')
      const entryPath = join(root, 'entry.ts')
      await Deno.writeTextFile(
        entryPath,
        "import { jsx } from 'react/jsx-runtime'\nexport const value = typeof jsx === 'function'\n",
      )

      const batchContext = createImportBatchContext()
      try {
        const mod = await importProjectModule(entryPath, batchContext)
        assertEquals(
          mod.value,
          true,
          "the real react/jsx-runtime import must actually resolve and expose 'jsx' — a raw " +
            'file:// node_modules import would fail this outright',
        )

        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])
        assert(
          !rewritten.includes('/node_modules/'),
          'the rewritten temp file still contains a raw file:// node_modules path — ' +
            'resolveReplacement regressed back to splicing that in directly instead of ' +
            "reconstructing the scheme specifier form (see this test's own doc for the full " +
            'account).',
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
  "importProjectModule: a project's OWN bare specifier (not shared with cli's config) resolving " +
    'to an UNEXPANDED jsr:/http(s) literal gets forced through a real dependency-constraint solve ' +
    'too, never left as the raw, unexpanded literal',
  async () => {
    // Verifies the same class of gap in a DIFFERENT branch:
    // `referrerLoader.resolveSync(specifier, ...)` ALONE can return an unexpanded literal — e.g.
    // `referrerLoader.resolveSync('@zanix/auth', ...)`, against a real project's own config,
    // returns the literal `jsr:@zanix/auth@^X.Y.Z`, not a resolved version. Splicing that literal
    // in directly hands the ACTUAL version-range resolution to native `import()` at RUNTIME —
    // governed by whatever config/lockfile the PROCESS itself was started with, never
    // `referrerLoader`'s own `newestDependencyDate`, so a project's own `"minimumDependencyAge"`
    // setting has NO effect on the specifier this branch actually splices in, even with
    // `"minimumDependencyAge": 0` set in the project's own `deno.json`.
    //
    // `@std/csv` is used here specifically because it is NOT declared anywhere in `cli`'s own
    // `deno.jsonc` — this must exercise the project-anchored `referrerLoader` branch, never the
    // earlier `cliLoader` shortcut (which has its own, already-covered test above).
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        '{"imports": {"@std/csv": "jsr:@std/csv@^1.0.0"}, "minimumDependencyAge": 0}\n',
      )
      const entryPath = join(root, 'entry.ts')
      await Deno.writeTextFile(
        entryPath,
        "import { stringify } from '@std/csv'\nexport const value = typeof stringify\n",
      )

      const batchContext = createImportBatchContext()
      try {
        const mod = await importProjectModule(entryPath, batchContext)
        assertEquals(mod.value, 'function', 'the real @std/csv import must actually resolve')

        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])
        const specifierMatch = rewritten.match(/from\s+(['"])(.+?)\1/)
        assert(specifierMatch, 'expected a real import specifier in the rewritten temp file')
        const resolvedSpecifier = specifierMatch[2]

        assert(
          !/@[\^~]\d/.test(resolvedSpecifier),
          `the rewritten specifier '${resolvedSpecifier}' still carries a bare semver RANGE ` +
            "(e.g. '^1.0.0'), not a fully-resolved exact version — resolveReplacement's " +
            'project-anchored branch regressed back to splicing an unexpanded jsr:/http(s): ' +
            'literal instead of forcing a real dependency-constraint solve first (see this ' +
            "test's own doc for the full account).",
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
  'reconstructNpmSpecifierFromResolvedPath: parses a real, currently-resolved Deno npm-cache ' +
    "path (react's own CJS jsx-runtime shim) into a working npm: specifier, with no config file " +
    'read at all',
  async () => {
    // Verifies that the `node_modules` reconstruction works even with no local config FILE to
    // read at all: `reconstructSchemeSpecifier`'s own `cliConfigPath`/`referrerConfigPath`-based
    // reconstruction (used in both `resolveReplacement`'s `cliLoader` branch and its
    // project-anchored counterpart) needs a real config file, but `cliConfigPath` is `undefined`
    // for any genuine `deno install -g jsr:@zanix/cli` install (never a local checkout), so it
    // alone silently no-ops on every real-world case that needs it — no unit test can catch this
    // directly, since a `deno test` run always has a real `file://` `import.meta.url`, so
    // `cliConfigPath` can never actually BE `undefined` in that context (same limitation
    // `getCliLoader`'s own test above documents). `reconstructNpmSpecifierFromResolvedPath` needs
    // no config file at all, parsing the version straight out of Deno's own stable npm-cache
    // directory layout.
    const reactPath = new URL(
      '../../../../../../node_modules/.deno/react@19.2.8/node_modules/react/jsx-runtime.js',
      import.meta.url,
    )
    const resolved = await Deno.stat(reactPath).then(() => true).catch(() => false)
    assert(
      resolved,
      `expected a real, currently-cached react@19.2.8 at ${reactPath} — if this repo's own ` +
        'react version bumped, update this fixture path to match',
    )

    const reconstructed = reconstructNpmSpecifierFromResolvedPath(
      reactPath.href,
      'react/jsx-runtime',
    )
    assertEquals(reconstructed, 'npm:react@19.2.8/jsx-runtime')

    // Not just a string match — confirm the reconstructed specifier actually resolves and works,
    // the same real interop check the original bug was about. The literal, not `reconstructed`
    // itself, so this still exercises a real import even if the assertion above regresses.
    const mod = await import('npm:react@19.2.8/jsx-runtime') as { jsx: unknown }
    assertEquals(typeof mod.jsx, 'function')
  },
)

Deno.test(
  'reconstructNpmSpecifierFromResolvedPath: parses a scoped package (Deno\'s own "+" separator ' +
    'convention in its npm-cache directory names, e.g. @radix-ui+primitive)',
  () => {
    const resolved = 'file:///project/node_modules/.deno/@radix-ui+primitive@1.1.7/' +
      'node_modules/@radix-ui/primitive/dist/index.mjs'
    assertEquals(
      reconstructNpmSpecifierFromResolvedPath(resolved, '@radix-ui/primitive'),
      'npm:@radix-ui/primitive@1.1.7',
    )
  },
)

Deno.test(
  "reconstructNpmSpecifierFromResolvedPath: returns undefined for a path that isn't Deno's own " +
    'npm-cache layout at all — never a wrong guess',
  () => {
    assertEquals(
      reconstructNpmSpecifierFromResolvedPath(
        'file:///some/vendored/local/copy/react/jsx-runtime.js',
        'react/jsx-runtime',
      ),
      undefined,
    )
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
  'readNewestDependencyDate: "minimumDependencyAge": 0 (a real shape a project\'s own deno.json ' +
    'uses) resolves to effectively "right now" — every already-published dependency version ' +
    'passes',
  async () => {
    // Verifies that `@deno/loader`'s own config-file discovery, which never translates this field
    // on its own, doesn't leave a project's own "minimumDependencyAge": 0 without effect: a
    // Workspace constructed from configPath alone would otherwise still reject a
    // same-day-published dependency under Deno's own default 24h window.
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

Deno.test(
  'cliLoaderHasNoRealLocalAnswer: true only for a file:// result outside node_modules, and only ' +
    'when configPath is undefined (a genuine global install, where cliLoader can never have a ' +
    'real local answer of its own at all)',
  () => {
    // Verifies that under a genuine global install (`cliConfigPath === undefined`), where
    // `cliLoader` is built via config-file auto-discovery from `Deno.cwd()` — the served
    // PROJECT's own directory — and so becomes identical to `referrerLoader`, resolving a
    // project's own bare LOCAL alias (e.g. "triggers/") to a real project file counts as
    // `cliLoader` having no real answer of its own, rather than being trusted as a genuine
    // cli-own answer: mistakenly trusting it surfaces as
    // `Import "clients/registry-hub.client.ts" not a dependency`, thrown from the ORIGINAL
    // `triggers.interactor.ts`, never recursed into because `resolveReplacement` treats the
    // mismatch as a real `cliLoader` answer.
    assertEquals(
      cliLoaderHasNoRealLocalAnswer(undefined, 'file:///project/src/triggers/interactor.ts'),
      true,
      'a file:// result with no configPath at all must be treated as "cli has no real answer"',
    )

    // A real cli-own answer under a genuine global install is always jsr:/https: (a real package
    // identity), never file:// — this function's own guard should never trigger for those.
    assertEquals(
      cliLoaderHasNoRealLocalAnswer(undefined, 'https://jsr.io/@zanix/space/1.3.0/mod.ts'),
      false,
    )
    assertEquals(
      cliLoaderHasNoRealLocalAnswer(undefined, 'jsr:@zanix/space@^1.1.0'),
      false,
    )

    // A file:// result landing in node_modules IS a genuine cli-own npm dependency answer (react,
    // preact, ...) — never a project's own source file, so this guard must never trigger for it
    // either, regardless of configPath.
    assertEquals(
      cliLoaderHasNoRealLocalAnswer(
        undefined,
        'file:///some/cache/node_modules/.deno/react@19.2.8/node_modules/react/index.js',
      ),
      false,
    )

    // A real local checkout (configPath defined) has a genuine cli-own source tree to compare
    // against — resolvesIntoCliOwnSourceTree's own check is what applies there, not this one; a
    // defined configPath must always short-circuit this guard to false.
    assertEquals(
      cliLoaderHasNoRealLocalAnswer(
        '/Users/dev/cli/deno.jsonc',
        'file:///project/src/triggers/interactor.ts',
      ),
      false,
    )
  },
)

Deno.test(
  'detectTransitiveCollisionPackages: an empty set for a project with no deno.json(c) at all — ' +
    'nothing to detect a collision against',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      const collisions = await detectTransitiveCollisionPackages(root)
      assertEquals(collisions.size, 0)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// The next two tests cover the zero- and one-direct-import shapes separately (never a shared
// loop over both — `no-await-in-loop` flags exactly that shape, and it also keeps each fixture's
// own `finally` cleanup scoped to a single, independent `Deno.test`, the convention every other
// fixture in this file already follows). Neither shape can possibly exhibit the "reachable both
// directly and transitively via a DIFFERENT direct import" condition this function looks for, so
// both must short-circuit to an empty set without spawning a single subprocess — the common case
// for the overwhelming majority of real projects (a plain `space` project declaring only
// `@zanix/space`, or a `server` project declaring only `@zanix/server`), which must stay a fast,
// pure no-op for them.

Deno.test(
  'detectTransitiveCollisionPackages: an empty set for a project declaring NO direct @zanix/* ' +
    'imports at all — nothing that could carry one transitively',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(join(root, 'deno.json'), JSON.stringify({ imports: {} }))
      const collisions = await detectTransitiveCollisionPackages(root)
      assertEquals(collisions.size, 0)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'detectTransitiveCollisionPackages: an empty set for a project declaring exactly ONE direct ' +
    '@zanix/* import — no OTHER direct import exists to carry it transitively',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({ imports: { '@zanix/server': 'jsr:@zanix/server@^4.0.0' } }),
      )
      const collisions = await detectTransitiveCollisionPackages(root)
      assertEquals(collisions.size, 0)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'detectTransitiveCollisionPackages: flags @zanix/server for a project directly importing both ' +
    "@zanix/server AND @zanix/datamaster — @zanix/datamaster's own published deno.jsonc declares " +
    '"@zanix/server": "jsr:@zanix/server@^4.0.0" as its own internal dependency, exactly the ' +
    'confirmed real-world shape (real repro against the actually-published packages, not a ' +
    'synthetic stand-in — this exact pairing IS the reported bug)',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/server': 'jsr:@zanix/server@^4.0.0',
            '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.0',
          },
        }),
      )
      const collisions = await detectTransitiveCollisionPackages(root)
      assert(
        collisions.has('@zanix/server'),
        `expected '@zanix/server' to be flagged as a collision risk (found: ${
          [...collisions].join(', ') || '(none)'
        }) — if @zanix/datamaster's own published dependency on @zanix/server ever changes shape, ` +
          'update this fixture to match',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "detectTransitiveCollisionPackages: records its own collision-check temp file's directory in " +
    "the global manifest — the same directory a LINKED sibling's own config could sit in, which " +
    "sweepStaleGeneratedModules' structural scan alone would never reach",
  async () => {
    const root = await Deno.makeTempDir()
    const manifestPath = defaultGeneratedModuleDirsManifestPath()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/server': 'jsr:@zanix/server@^4.0.0',
            '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.0',
          },
        }),
      )
      await detectTransitiveCollisionPackages(root)

      const dirs = await readGeneratedModuleDirsManifest(manifestPath)
      assert(dirs.includes(root), `expected ${root} to be recorded in ${manifestPath}`)
    } finally {
      await Deno.remove(root, { recursive: true })
      // Only ever removes THIS test's own entry — the manifest is real, global, shared state (see
      // recordGeneratedModuleDir's own doc), not a fixture this test owns outright.
      const dirs = (await readGeneratedModuleDirsManifest(manifestPath)).filter((d) => d !== root)
      await Deno.writeTextFile(manifestPath, JSON.stringify(dirs)).catch(() => {})
    }
  },
)

Deno.test(
  'detectTransitiveCollisionPackages: reads the WORKSPACE MEMBER own imports, never the ' +
    "workspace root's — a real, confirmed shape (a workspace root's own config commonly carries " +
    "only `scopes`, leaving each member to declare its own direct imports), where the root's own " +
    '(import-less) config is not a usable answer for what a specific member directly declares',
  async () => {
    const workspaceRoot = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(workspaceRoot, 'deno.json'),
        JSON.stringify({ workspace: ['./packages/web'] }),
      )
      const memberRoot = join(workspaceRoot, 'packages', 'web')
      await Deno.mkdir(memberRoot, { recursive: true })
      await Deno.writeTextFile(
        join(memberRoot, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/server': 'jsr:@zanix/server@^4.0.0',
            '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.0',
          },
        }),
      )

      const collisions = await detectTransitiveCollisionPackages(memberRoot)
      assert(
        collisions.has('@zanix/server'),
        "expected '@zanix/server' to still be flagged from the WORKSPACE MEMBER's own root — " +
          `found: ${
            [...collisions].join(', ') || '(none)'
          } — detection regressed back to reading the workspace root's own (import-less) config ` +
          "instead of the member's.",
      )
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true })
    }
  },
)

Deno.test(
  'detectTransitiveCollisionPackages: memoizes per root — a second call for the SAME root reuses ' +
    'the first result rather than spawning another deno info --json subprocess',
  async () => {
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/server': 'jsr:@zanix/server@^4.0.0',
            '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.0',
          },
        }),
      )
      const first = await detectTransitiveCollisionPackages(root)
      const start = performance.now()
      const second = await detectTransitiveCollisionPackages(root)
      const elapsedMs = performance.now() - start
      assertEquals([...second].sort(), [...first].sort())
      assert(
        elapsedMs < 50,
        `second call took ${elapsedMs}ms — expected a near-instant cache hit, not a fresh ` +
          're-resolution (would double the real network cost of this detection on every ' +
          'importProjectModule/importProjectDependency call within one process)',
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'importProjectModule: a flagged transitive-collision-risk specifier (@zanix/server, alongside ' +
    'a direct @zanix/datamaster import) is spliced into the rewritten temp file as the UNEXPANDED ' +
    'jsr: literal — deliberately NOT forced through the eager dependency-constraint solve every ' +
    "other bare specifier gets, per resolveReplacement's own matching branch",
  async () => {
    // This is the other half of the confirmed fix: an unflagged specifier (covered by the
    // existing "gets forced through a real dependency-constraint solve" tests above) MUST keep
    // getting eagerly resolved to an exact URL, but a FLAGGED one must NOT — leaving it unexpanded
    // is precisely what lets native `import()`, running under a process
    // `prepareTransitiveCollisionReexec` already fixed up, unify it with @zanix/datamaster's own
    // internal (compatible) request for the same package, instead of two independently-resolved
    // URLs silently diverging into two separate module instances (the actual reported bug,
    // reproduced empirically — see this repo's own PR/issue history for the real instanceof-false
    // repro this fix targets).
    const root = await Deno.makeTempDir()
    try {
      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: {
            '@zanix/server': 'jsr:@zanix/server@^4.0.0',
            '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.9.0',
          },
        }),
      )
      const entryPath = join(root, 'entry.ts')
      await Deno.writeTextFile(
        entryPath,
        "import { ZanixProvider } from '@zanix/server'\nexport const value = typeof ZanixProvider\n",
      )

      const batchContext = createImportBatchContext()
      try {
        await importProjectModule(entryPath, batchContext)
        assertEquals(batchContext.tempFiles.length, 1)
        const rewritten = await Deno.readTextFile(batchContext.tempFiles[0])
        const specifierMatch = rewritten.match(/from\s+(['"])(.+?)\1/)
        assert(specifierMatch, 'expected a real import specifier in the rewritten temp file')
        const resolvedSpecifier = specifierMatch[2]

        assert(
          /^jsr:@zanix\/server@[\^~]/.test(resolvedSpecifier),
          `expected the flagged '@zanix/server' specifier to stay an UNEXPANDED range literal ` +
            `(e.g. 'jsr:@zanix/server@^4.0.0'), got '${resolvedSpecifier}' instead — the ` +
            "collision-risk skip in resolveReplacement's referrer branch regressed.",
        )
      } finally {
        await cleanupImportBatch(batchContext)
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
