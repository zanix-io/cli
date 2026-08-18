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
  assert(!folderExists(project + '/.github/workflows'))

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

  assert(
    fileExists(project + '/src/server/handlers/rtos/validations/IsObjectID.ts'),
    "example.rto.ts's own IsObjectID import must actually exist, not be scaffold-illustrative only",
  )
  const constants = await Deno.readTextFile(
    project + '/src/utils/constants.ts',
  )
  assert(
    constants.includes('OBJECTID_REGEX'),
    'constants.ts must declare OBJECTID_REGEX',
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
  assert(!folderExists(project + '/.github/workflows'))

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
  assert(!folderExists(project + '/.github/workflows'))

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
      '@zanix/core',
      '@zanix/space',
    ]
  ) {
    assert(
      config.includes(`"${pkg}"`),
      `deno.json must declare ${pkg} as a dependency`,
    )
  }

  assert(
    fileExists(project + '/src/server/handlers/rtos/validations/IsObjectID.ts'),
    "example.rto.ts's own IsObjectID import must actually exist, not be scaffold-illustrative only",
  )
  const constants = await Deno.readTextFile(
    project + '/src/utils/constants.ts',
  )
  assert(
    constants.includes('OBJECTID_REGEX'),
    'constants.ts must declare OBJECTID_REGEX',
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
