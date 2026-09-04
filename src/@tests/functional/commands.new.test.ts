import { fileExists, folderExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'

const temporaryFolder = getTemporaryFolder(import.meta.url)

/** Every file path under `dir`, relative to `dir`, sorted — for comparing two generated
 * projects' full trees regardless of walk order. */
async function listFilesRecursively(
  dir: string,
  base: string = dir,
): Promise<string[]> {
  const out: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory) {
      out.push(...await listFilesRecursively(full, base))
    } else {
      out.push(full.slice(base.length))
    }
  }
  return out.sort()
}

Deno.test('new command server should create some base folders', async () => {
  const project = `${temporaryFolder}/server-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'server', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(
    fileExists(project + '/.github/workflows/ci.yml'),
    'the default `--prepare` step writes ci.yml for every project type — see docs/new.md',
  )
  assert(
    !fileExists(project + '/.github/workflows/publish.yml'),
    'publish.yml is only written for library/app project types, not server',
  )

  assert(folderExists(project + '/src/server'))
  assert(!folderExists(project + '/src/space'))
  assert(!folderExists(project + '/src/modules'))

  assert(fileExists(project + '/mod.ts'))
  const mod = await Deno.readTextFile(project + '/mod.ts')
  assert(
    mod.includes("from '@zanix/core'"),
    'mod.ts must import @zanix/core, not be empty',
  )
  assert(mod.includes('Zanix.start()'), 'mod.ts must call Zanix.start()')
  assert(
    !fileExists(project + '/space.app.ts'),
    'a plain server project has no @zanix/space app, so no space.app.ts either',
  )

  assert(
    fileExists(project + '/worker.ts'),
    'a server project must have a worker entrypoint too',
  )
  const worker = await Deno.readTextFile(project + '/worker.ts')
  assert(
    worker.includes("from '@zanix/core'"),
    'worker.ts must import @zanix/core',
  )
  assert(
    worker.includes('Zanix.startWorker()'),
    'worker.ts must call Zanix.startWorker()',
  )

  const config = await Deno.readTextFile(project + '/deno.json')
  for (
    const pkg of [
      '@zanix/server',
      '@zanix/datamaster',
      '@zanix/asyncmq',
      '@zanix/asyncmq/jobs',
      '@zanix/core',
    ]
  ) {
    assert(
      config.includes(`"${pkg}"`),
      `deno.json must declare ${pkg} as a dependency`,
    )
  }
  assert(
    config.includes('"@zanix/validator"'),
    'deno.json must declare @zanix/validator (aliased into @zanix/utils) as a dependency',
  )
  assert(config.includes('"worker"'), 'deno.json must declare a worker task')

  const rtoContent = await Deno.readTextFile(
    project + '/src/server/handlers/rtos/example.rto.ts',
  )
  assert(
    rtoContent.includes('IsObjectID') &&
      rtoContent.includes("from '@zanix/validator'"),
    "example.rto.ts's `id` field must import the real IsObjectID from @zanix/validator, " +
      'not a hand-generated local file',
  )
  assert(
    !fileExists(project + '/src/server/handlers/rtos/validations/IsObjectID.ts'),
    "objectId no longer generates a local IsObjectID.ts — see rto/renderer.ts's own doc",
  )

  // `LICENSE` is common to every project type (`commons.ts`'s `getCommonTree`), fetched verbatim
  // from `@zanix/utils`'s own `src/templates/LICENSE`. `[YEAR]` is real and knowable (today's
  // calendar year) — `createFilesAndFolders`'s own `fillLicenseYear` fills it in for real, the
  // same fix `@zanix/admin`'s own LICENSE needed by hand once. `[ORGANIZATION]` is deliberately
  // left as an unmistakable placeholder, same reasoning as `baseZnxConfig`'s `@your-scope`.
  const license = await Deno.readTextFile(project + '/LICENSE')
  assert(
    license.includes(`Copyright (c) ${new Date().getFullYear()} [ORGANIZATION]`),
    `LICENSE must have the real current year substituted, [ORGANIZATION] left as a placeholder — got: ${license}`,
  )

  // Real end-to-end proof of the `@zanix/core` migration (`docs/engineering.md` §5): before it,
  // `src/shared/middlewares/{pipe,interceptor}.defs.ts` were fetched from `@zanix/core`'s own
  // (never actually published) `src/templates/`, and this whole command hard-failed with a real
  // 404 against `jsr.io/@zanix/core/.../src/templates/middlewares/pipe.defs.ts` (reproduced
  // directly, outside this suite, against the pre-fix source). Now generated locally via `zanix
  // generate middleware`'s own `planMiddleware`, so the command succeeds and both files exist with
  // real, non-empty, correctly-suffixed content.
  assert(
    fileExists(project + '/src/shared/middlewares/example.pipe.ts'),
    'example.pipe.ts must exist — generated locally via planMiddleware, no @zanix/core JSR fetch',
  )
  assert(
    fileExists(project + '/src/shared/middlewares/example.interceptor.ts'),
    'example.interceptor.ts must exist — generated locally via planMiddleware, no @zanix/core JSR fetch',
  )
  assert(
    !fileExists(project + '/src/shared/middlewares/pipe.defs.ts'),
    'the old JSR-fetched pipe.defs.ts filename must be gone',
  )
  const middlewarePipe = await Deno.readTextFile(
    project + '/src/shared/middlewares/example.pipe.ts',
  )
  assert(
    middlewarePipe.includes('defineMiddlewareDecorator') && middlewarePipe.includes('ExamplePipe'),
    'example.pipe.ts must contain the real defineMiddlewareDecorator shell, not empty/placeholder content',
  )
  const middlewareInterceptor = await Deno.readTextFile(
    project + '/src/shared/middlewares/example.interceptor.ts',
  )
  assert(
    middlewareInterceptor.includes('defineMiddlewareDecorator') &&
      middlewareInterceptor.includes('ExampleInterceptor'),
    'example.interceptor.ts must contain the real defineMiddlewareDecorator shell, not empty/placeholder content',
  )

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command space should create some base folders', async () => {
  const project = `${temporaryFolder}/space-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'space', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(
    fileExists(project + '/.github/workflows/ci.yml'),
    'the default `--prepare` step writes ci.yml for every project type — see docs/new.md',
  )
  assert(
    !fileExists(project + '/.github/workflows/publish.yml'),
    'publish.yml is only written for library/app project types, not space',
  )

  assert(!folderExists(project + '/src/server'))
  assert(folderExists(project + '/src/space'))
  assert(!folderExists(project + '/src/modules'))

  assert(
    fileExists(project + '/mod.ts'),
    'a plain space project must have a real entrypoint',
  )
  const mod = await Deno.readTextFile(project + '/mod.ts')
  assert(
    mod.includes("from './space.app.ts'"),
    'mod.ts must import the manifest from space.app.ts, never declare it inline',
  )
  assert(
    !mod.includes('defineSpaceApp('),
    'the manifest itself belongs in space.app.ts, not mod.ts',
  )
  assert(
    mod.includes("from '@zanix/app/runtime'"),
    'mod.ts must import bootstrapRemoteApp from @zanix/app/runtime, never bare @zanix/app',
  )
  assert(
    mod.includes('bootstrapRemoteApp('),
    'mod.ts must activate and serve the app via bootstrapRemoteApp (graceful shutdown included)',
  )
  assert(
    !mod.includes('@zanix/core'),
    'a pure space project must never depend on @zanix/core',
  )
  assert(
    mod.includes('getBootstrapSpaceAppConfig()'),
    'mod.ts must pass getBootstrapSpaceAppConfig() as the whole bootstrapRemoteApp options ' +
      'argument, never a hand-written { server: { ssr: {} } } literal (that would silently ' +
      'exclude rest, breaking POST /api/log)',
  )
  assert(
    !mod.includes('loadCometManifest') && !mod.includes('loadCssManifest') &&
      !mod.includes('loadPwaBuildOutput'),
    'defineSpaceApp() already auto-loads every production manifest once activated — a manual ' +
      'load here would just duplicate it',
  )

  assert(
    !fileExists(project + '/worker.ts'),
    'a pure space project has no @zanix/core dependency, so no worker entrypoint either',
  )

  assert(
    fileExists(project + '/space.app.ts'),
    'zanix space dev needs the manifest importable in isolation, split out of mod.ts',
  )
  const spaceApp = await Deno.readTextFile(project + '/space.app.ts')
  assert(
    spaceApp.includes("from '@zanix/space'"),
    'space.app.ts must import @zanix/space',
  )
  assert(
    spaceApp.includes('defineSpaceApp('),
    'space.app.ts must declare the app manifest',
  )
  assert(
    spaceApp.includes('export default'),
    'space.app.ts must export the manifest as default',
  )

  const config = await Deno.readTextFile(project + '/deno.json')
  assert(
    config.includes('"@zanix/space"'),
    'deno.json must declare @zanix/space as a dependency',
  )

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command spacecraft should create some base folders', async () => {
  const project = `${temporaryFolder}/spacecraft-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'spacecraft', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(
    fileExists(project + '/.github/workflows/ci.yml'),
    'the default `--prepare` step writes ci.yml for every project type — see docs/new.md',
  )
  assert(
    !fileExists(project + '/.github/workflows/publish.yml'),
    'publish.yml is only written for library/app project types, not spacecraft',
  )

  assert(folderExists(project + '/src/server'))
  assert(folderExists(project + '/src/space'))
  assert(!folderExists(project + '/src/modules'))

  assert(fileExists(project + '/mod.ts'))
  const mod = await Deno.readTextFile(project + '/mod.ts')
  assert(
    mod.includes("from '@zanix/core'"),
    'mod.ts must import @zanix/core, not be empty',
  )
  assert(
    mod.includes('Zanix.start({'),
    'mod.ts must call Zanix.start() with the space app wired in',
  )
  assert(
    mod.includes("from './space.app.ts'"),
    'mod.ts must import the manifest from space.app.ts, never declare it inline',
  )
  assert(
    !mod.includes('defineSpaceApp('),
    'the manifest itself belongs in space.app.ts, not mod.ts',
  )
  assert(
    mod.includes('apps:'),
    'mod.ts must register the space app as a named Zanix.start() app',
  )
  assert(
    mod.includes('getBootstrapSpaceAppConfig()'),
    'mod.ts must reuse getBootstrapSpaceAppConfig(), never a hand-written server: { ssr: {} } ' +
      'literal',
  )
  assert(
    !mod.includes('loadCometManifest') && !mod.includes('loadCssManifest') &&
      !mod.includes('loadPwaBuildOutput'),
    'defineSpaceApp() already auto-loads every production manifest once Zanix.start({ apps }) ' +
      'activates it — a manual load here would just duplicate it, the same convention the ' +
      'pure-space mod.ts follows',
  )

  assert(
    fileExists(project + '/worker.ts'),
    'a space-server project must have a worker entrypoint too',
  )
  const worker = await Deno.readTextFile(project + '/worker.ts')
  assert(
    worker.includes('Zanix.startWorker()'),
    'worker.ts must call Zanix.startWorker()',
  )

  assert(
    fileExists(project + '/space.app.ts'),
    'zanix space dev needs the manifest importable in isolation, split out of mod.ts',
  )
  const spaceApp = await Deno.readTextFile(project + '/space.app.ts')
  assert(
    spaceApp.includes("from '@zanix/space'"),
    'space.app.ts must import @zanix/space',
  )
  assert(
    spaceApp.includes('defineSpaceApp('),
    'space.app.ts must declare the app manifest',
  )

  const config = await Deno.readTextFile(project + '/deno.json')
  for (
    const pkg of [
      '@zanix/server',
      '@zanix/datamaster',
      '@zanix/asyncmq',
      '@zanix/asyncmq/jobs',
      '@zanix/core',
      '@zanix/space',
    ]
  ) {
    assert(
      config.includes(`"${pkg}"`),
      `deno.json must declare ${pkg} as a dependency`,
    )
  }

  const rtoContent = await Deno.readTextFile(
    project + '/src/server/handlers/rtos/example.rto.ts',
  )
  assert(
    rtoContent.includes('IsObjectID') &&
      rtoContent.includes("from '@zanix/validator'"),
    "example.rto.ts's `id` field must import the real IsObjectID from @zanix/validator, " +
      'not a hand-generated local file',
  )
  assert(
    !fileExists(project + '/src/server/handlers/rtos/validations/IsObjectID.ts'),
    "objectId no longer generates a local IsObjectID.ts — see rto/renderer.ts's own doc",
  )

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command library should create some base folders', async () => {
  const project = `${temporaryFolder}/library-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'library', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(fileExists(project + '/.github/workflows/publish.yml'))

  assert(!folderExists(project + '/src/server'))
  assert(!folderExists(project + '/src/space'))
  assert(folderExists(project + '/src/modules'))

  const config = JSON.parse(await Deno.readTextFile(project + '/deno.json'))
  assertEquals(
    Object.keys(config.imports).some((key) => key.startsWith('@zanix/')),
    false,
    'a library scaffold imports nothing @zanix/* by default',
  )

  // `README.md`/`CHANGELOG.md`/`LICENSE`/etc still fetch from `@zanix/utils`'s own JSR-published
  // `src/templates/` — real proof the `[YEAR]` substitution survives that fetch path too, not
  // only the locally-generated leaves.
  const license = await Deno.readTextFile(project + '/LICENSE')
  assert(
    license.includes(`Copyright (c) ${new Date().getFullYear()} [ORGANIZATION]`),
    `LICENSE must have the real current year substituted, [ORGANIZATION] left as a placeholder — got: ${license}`,
  )

  // `mod.ts`/`src/modules/mod.ts` are both generated locally now (never fetched from another
  // package's own live source) — see `library.ts`'s own `getLibraryRootModTemplate`/
  // `getLibraryModTemplate`.
  const mod = await Deno.readTextFile(project + '/mod.ts')
  assert(
    mod.includes("export * from './src/modules/mod.ts'"),
    'mod.ts must re-export the real src/modules/mod.ts starter content, not be empty',
  )

  const moduleMod = await Deno.readTextFile(project + '/src/modules/mod.ts')
  assert(
    moduleMod.includes('export function example'),
    'src/modules/mod.ts must be a real, non-empty starter module',
  )

  await Deno.remove(project, { recursive: true })
})

Deno.test('new command app should create a real, non-empty defineZanixApp() manifest', async () => {
  const project = `${temporaryFolder}/app-project`
  await new Deno.Command('deno', {
    args: ['run', 'new', 'app', project],
  }).output()

  assert(fileExists(project + '/.github/hooks/pre-commit'))
  assert(fileExists(project + '/.github/hooks/pre-push'))
  assert(fileExists(project + '/.github/workflows/publish.yml'))

  assert(!folderExists(project + '/src/server'))
  assert(!folderExists(project + '/src/space'))
  assert(!folderExists(project + '/src/modules'))

  assert(fileExists(project + '/mod.ts'))
  const mod = await Deno.readTextFile(project + '/mod.ts')
  assert(
    mod.includes("from '@zanix/app'"),
    'mod.ts must import @zanix/app, not be empty',
  )
  assert(mod.includes('defineZanixApp'), 'mod.ts must call defineZanixApp()')

  const config = await Deno.readTextFile(project + '/deno.json')
  assert(
    config.includes('"@zanix/app"'),
    'deno.json must declare @zanix/app as a dependency',
  )

  await Deno.remove(project, { recursive: true })
})

Deno.test(
  'new command server --template base produces the exact same tree as omitting --template (real CLI process, not just the in-process tree builder)',
  async () => {
    // Same trailing folder name (`server-project`) under two different parents — generated content
    // interpolates the project name (README, mod.ts, deno.json), so a genuine content diff must
    // compare two projects with the same name, not just the same `--template`.
    const implicitProject = `${temporaryFolder}/preset-implicit/server-project`
    const explicitProject = `${temporaryFolder}/preset-explicit/server-project`

    await new Deno.Command('deno', {
      args: ['run', 'new', 'server', implicitProject],
    }).output()
    await new Deno.Command('deno', {
      args: ['run', 'new', 'server', explicitProject, '--template', 'base'],
    }).output()

    const implicitFiles = await listFilesRecursively(implicitProject)
    const explicitFiles = await listFilesRecursively(explicitProject)

    assertEquals(
      implicitFiles,
      explicitFiles,
      'omitting --template and passing --template base must produce identical file trees',
    )

    await Promise.all(implicitFiles.map(async (relPath) => {
      const [implicitContent, explicitContent] = await Promise.all([
        Deno.readTextFile(implicitProject + relPath),
        Deno.readTextFile(explicitProject + relPath),
      ])
      assertEquals(
        implicitContent,
        explicitContent,
        `content differs for ${relPath}`,
      )
    }))

    await Deno.remove(`${temporaryFolder}/preset-implicit`, {
      recursive: true,
    })
    await Deno.remove(`${temporaryFolder}/preset-explicit`, {
      recursive: true,
    })
  },
)

Deno.test(
  'new command server --template <unknown> fails clearly and writes no files',
  async () => {
    const project = `${temporaryFolder}/server-preset-unknown`
    const output = await new Deno.Command('deno', {
      args: ['run', 'new', 'server', project, '--template', 'does-not-exist'],
    }).output()

    assert(
      !output.success,
      'the command must exit non-zero for an unknown --template',
    )
    const stderr = new TextDecoder().decode(output.stderr)
    assert(
      stderr.includes('does-not-exist') && stderr.includes('base'),
      'stderr must name the offending template and list the known ones',
    )
    assert(
      !folderExists(project),
      'no project folder should be created for a failed --template',
    )
  },
)

Deno.test(
  'new command library --template <unknown> fails clearly too — no per-type registry to resolve',
  async () => {
    // `library` has no `ScaffoldRecipeRegistry` (see its own `getLibrarySrcTree` doc — a static JSR
    // file, not decomposable `plan<Name>` leaves) — protected instead by its own direct
    // `assertKnownPreset` call, on top of the upfront one `getZnxFolderTree` always runs first.
    const project = `${temporaryFolder}/library-preset-unknown`
    const output = await new Deno.Command('deno', {
      args: ['run', 'new', 'library', project, '--template', 'does-not-exist'],
    }).output()

    assert(
      !output.success,
      'the command must exit non-zero for an unknown --template',
    )
    assert(
      !folderExists(project),
      'no project folder should be created for a failed --template',
    )
  },
)

Deno.test(
  'new command server fails clearly (non-zero exit) and leaves no 0-byte/empty files when JSR/Shields.io are unreachable',
  async () => {
    // Regression coverage for the A8 audit finding: a failed template-content fetch (no network,
    // JSR down) used to be swallowed all the way down to `''`, silently written to disk as a
    // 0-byte file, while the command still reported success and exited 0. `--deny-net` denies
    // real network access to exactly the two hosts `zanix new` needs (`jsr.io`/`img.shields.io`)
    // — a genuine, unmocked "no network for these hosts" condition, run through the real CLI
    // subprocess end to end (Cliffy's own dispatcher included), not an in-process stub. This also
    // answers the open "does an unhandled rejection from the action surface correctly" question:
    // `newServerAction` has no local try/catch around its `createFilesAndFolders` call, and the
    // real exit code below is non-zero — Cliffy's own `parseCommand` already awaits the action
    // inside a try/catch that routes any rejection through `this.throw` → this repo's own
    // `errorHandlerFn` (`cli.ts`'s `setErrorHandler`) → `Deno.exit(1)`.
    //
    // Invoked as `deno run -A --deny-net=... mod.ts new server <project>` directly (not via the
    // `deno task new`/`deno run new` shorthand every other test in this file uses) — that
    // shorthand always resolves to a hardcoded `deno run -A mod.ts ...` with no way to layer an
    // extra `--deny-net` onto it from the outside.
    const project = `${temporaryFolder}/server-deny-net`
    const output = await new Deno.Command('deno', {
      args: [
        'run',
        '-A',
        '--deny-net=jsr.io,img.shields.io',
        'mod.ts',
        'new',
        'server',
        project,
      ],
    }).output()

    assert(
      !output.success,
      'the command must exit non-zero when it cannot fetch template content/versions at all',
    )
    const stderr = new TextDecoder().decode(output.stderr)
    assert(
      stderr.includes('Shields.io') || stderr.includes('jsr.io'),
      `stderr must name the real failure, not a generic/unrelated one — got: ${stderr}`,
    )

    // Local (non-JSR) files still get written — only the JSR-tagged ones (README.md/LICENSE/
    // CHANGELOG.md/docs/see-more.md/etc., see `commands/new/lib/tree/projects/commons.ts`) were
    // ever affected by the swallow bug, so those are the ones that must be verified absent.
    for (const jsrTaggedFile of ['README.md', 'LICENSE', 'CHANGELOG.md', 'docs/see-more.md']) {
      assert(
        !fileExists(`${project}/${jsrTaggedFile}`),
        `'${jsrTaggedFile}' is JSR-tagged and its fetch was denied — it must not exist at all, ` +
          'and must never have been written as an empty (0-byte) file',
      )
    }

    // Whatever DID get written (the local, non-JSR files) must never be empty either — the
    // regression was specifically about content silently resolving to `''`.
    if (folderExists(project)) {
      const relPaths = await listFilesRecursively(project)
      const stats = await Promise.all(relPaths.map((relPath) => Deno.stat(project + relPath)))
      relPaths.forEach((relPath, i) => {
        assert(stats[i].size > 0, `'${relPath}' exists but is 0 bytes`)
      })
      await Deno.remove(project, { recursive: true })
    }
  },
)

Deno.test(
  'new command app --template <unknown> fails clearly too — app has its own registry now',
  async () => {
    // `app` used to be a bare `templates.base.push()` with no per-type validation of its own — now
    // it resolves through `APP_RECIPES` (`projects/app.ts`) exactly like `server`/`space`, so an
    // unknown `--template` is caught by app's own `resolveRecipe`, defense in depth beyond the
    // upfront global check.
    const project = `${temporaryFolder}/app-preset-unknown`
    const output = await new Deno.Command('deno', {
      args: ['run', 'new', 'app', project, '--template', 'does-not-exist'],
    }).output()

    assert(
      !output.success,
      'the command must exit non-zero for an unknown --template',
    )
    assert(
      !folderExists(project),
      'no project folder should be created for a failed --template',
    )
  },
)
