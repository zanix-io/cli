import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import {
  cleanupImportBatch,
  cliLoaderHasNoRealLocalAnswer,
  createImportBatchContext,
  importProjectModule,
  readNewestDependencyDate,
  reconstructNpmSpecifierFromResolvedPath,
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
  'importProjectModule: a bare specifier resolving to an UNEXPANDED jsr:/http(s): literal (a bare ' +
    'range, not a real version) gets forced through a real dependency-constraint solve before ' +
    'being spliced into the rewritten temp file — never the raw, unexpanded literal',
  async () => {
    // Real, confirmed regression this locks in: `cliLoader.resolveSync(specifier, ...)` ALONE can
    // return an unexpanded literal like `jsr:@zanix/space@^1.1.0` — the raw import-map VALUE, not
    // a real resolved version — for a jsr:/http(s): target. Splicing that literal directly into
    // the rewritten temp file let native `import()` perform its OWN, separate version-range
    // resolution at runtime, which can land on a DIFFERENT actual version than whatever `cli`'s
    // own static import of the same package resolved to — silently loading a SECOND module
    // instance of a package meant to be a process-wide singleton (`@zanix/space`'s own
    // `SpaceDevSocket`, which registers a route as a top-level side effect, is the real, confirmed
    // case: two instances means two registrations of the same route, throwing "already defined").
    // `@zanix/helpers` (used above) happens to ALSO resolve to an unexpanded literal
    // (`jsr:@zanix/utils@^4.1.0/helpers`) but doesn't exercise this distinction on its own — a
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
            "(e.g. '^1.1.0'), not a fully-resolved exact version — resolveReplacement regressed " +
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
    // Real, confirmed bug: the `cliResolved` branch above splices a `file://` path straight into
    // node_modules for a specifier resolving OUTSIDE cli's own source tree — but react's own CJS
    // entry (`node_modules/react/jsx-runtime.js`) is a runtime `if (process.env.NODE_ENV ===
    // 'production') { ... } else { ... }` conditional `require`, which Deno's static CJS→ESM
    // named-export analysis can't see through: a raw `file://` import of it exposes NO named
    // exports at all, so `import { jsx } from 'react/jsx-runtime'` fails outright even though the
    // file resolved successfully — reported live via `discoverPages`'s static-analysis pass.
    // Reconstructing the scheme-based specifier form (`npm:react@^19.2.0/jsx-runtime`) instead
    // hands native `import()` the same text a normal static import would use, with full npm
    // CJS/ESM interop intact — mirroring the identical fix the project-anchored `node_modules`
    // branch further down in `resolveReplacement` already has, for the exact same reason.
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
    // Real, confirmed gap this closes — the SAME class of bug as the cli-branch fix above, found
    // during the same audit but in a DIFFERENT branch: `referrerLoader.resolveSync(specifier, ...)`
    // ALONE can return an unexpanded literal (confirmed via a real, isolated repro:
    // `referrerLoader.resolveSync('@zanix/auth', ...)`, against a real project's own config,
    // returns the literal `jsr:@zanix/auth@^1.1.2`, not a resolved version). Splicing that literal
    // in directly hands the ACTUAL version-range resolution to native `import()` at RUNTIME —
    // governed by whatever config/lockfile the PROCESS itself was started with, never
    // `referrerLoader`'s own `newestDependencyDate`, so a project's own `"minimumDependencyAge"`
    // setting had NO effect on the specifier this branch actually spliced in — real, confirmed
    // failure reported live against `@zanix/auth`/`@zanix/datamaster`, even with
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
    // Real, confirmed bug this closes: the ORIGINAL `node_modules` reconstruction (both in
    // `resolveReplacement`'s `cliLoader` branch and its project-anchored counterpart) relied
    // entirely on reading a local config FILE (`cliConfigPath`/`referrerConfigPath`) — but
    // `cliConfigPath` is `undefined` for any genuine `deno install -g jsr:@zanix/cli` install
    // (never a local checkout), which made that reconstruction silently no-op on every real-world
    // case that needed it. Reported live (`zanix-iam`, a real global 2.0.8 install): the exact
    // same "does not provide an export named 'jsx'" failure, completely unchanged by that first
    // fix, because reconstruction never actually ran — no unit test caught this, since a `deno
    // test` run always has a real `file://` `import.meta.url`, so `cliConfigPath` can never
    // actually BE `undefined` in that context (same limitation `getCliLoader`'s own test above
    // documents). This function is the real fix: it needs no config file at all, parsing the
    // version straight out of Deno's own stable npm-cache directory layout.
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
  'readNewestDependencyDate: "minimumDependencyAge": 0 (the real, confirmed-in-production shape ' +
    'external-console\'s own deno.json uses) resolves to effectively "right now" — every ' +
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

Deno.test(
  'cliLoaderHasNoRealLocalAnswer: true only for a file:// result outside node_modules, and only ' +
    'when configPath is undefined (a genuine global install, where cliLoader can never have a ' +
    'real local answer of its own at all)',
  () => {
    // Real, confirmed bug this locks in: under a genuine global install (`cliConfigPath ===
    // undefined`), `cliLoader` is built via config-file auto-discovery from `Deno.cwd()` — the
    // served PROJECT's own directory — so it silently becomes identical to `referrerLoader`,
    // resolving a project's own bare LOCAL alias (e.g. "triggers/") to a real project file
    // instead of failing the way a genuine cli-own answer never would. Reported live
    // (`aeratech-console`, `zanix space build`): `Import "clients/registry-hub.client.ts" not a
    // dependency`, thrown from the ORIGINAL `triggers.interactor.ts` — never recursed into
    // because `resolveReplacement` trusted this as a real `cliLoader` answer.
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
