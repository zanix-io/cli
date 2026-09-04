import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import {
  ensureZanixDependency,
  PROJECT_TYPE_DEPENDENCIES,
  THIRD_PARTY_DEPENDENCY_VERSIONS,
  ZANIX_DEPENDENCY_VERSIONS,
} from 'utils/config/dependencies.ts'
import { baseZnxConfig } from 'utils/config/base.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(
  imports: Record<string, string> = {},
): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(
    `${projectFolder}/deno.json`,
    JSON.stringify({ imports }),
  )
  return projectFolder
}

Deno.test('ensureZanixDependency should add a missing import', async () => {
  const root = await makeProject()

  await ensureZanixDependency(root, '@zanix/server')

  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
  assertEquals(
    config.imports['@zanix/server'],
    ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
  )

  await Deno.remove(root, { recursive: true })
})

Deno.test('ensureZanixDependency should never overwrite an already-declared version', async () => {
  const root = await makeProject({
    '@zanix/server': 'jsr:@zanix/server@1.0.0',
  })

  await ensureZanixDependency(root, '@zanix/server')

  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
  assertEquals(config.imports['@zanix/server'], 'jsr:@zanix/server@1.0.0')

  await Deno.remove(root, { recursive: true })
})

Deno.test('ensureZanixDependency should add @zanix/server/graphql as its own key', async () => {
  const root = await makeProject()

  await ensureZanixDependency(root, '@zanix/server/graphql')

  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
  assertEquals(
    config.imports['@zanix/server/graphql'],
    ZANIX_DEPENDENCY_VERSIONS['@zanix/server/graphql'],
  )
  // Never conflated with the bare package's own entry — a project can declare one without the
  // other (e.g. a `rest`-only project never gets this key at all).
  assertEquals(config.imports['@zanix/server'], undefined)

  await Deno.remove(root, { recursive: true })
})

Deno.test('ensureZanixDependency should preserve unrelated existing imports', async () => {
  const root = await makeProject({ 'shared/': './src/shared/' })

  await ensureZanixDependency(root, '@zanix/asyncmq')

  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
  assertEquals(config.imports['shared/'], './src/shared/')
  assertEquals(
    config.imports['@zanix/asyncmq'],
    ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq'],
  )

  await Deno.remove(root, { recursive: true })
})

Deno.test('PROJECT_TYPE_DEPENDENCIES should only reference known dependency keys', () => {
  const knownKeys = new Set(Object.keys(ZANIX_DEPENDENCY_VERSIONS))

  for (const [projectType, pkgs] of Object.entries(PROJECT_TYPE_DEPENDENCIES)) {
    for (const pkg of pkgs) {
      assertEquals(
        knownKeys.has(pkg),
        true,
        `${projectType} references unknown package ${pkg}`,
      )
    }
  }
})

Deno.test('PROJECT_TYPE_DEPENDENCIES.library should declare no dependencies', () => {
  assertEquals(PROJECT_TYPE_DEPENDENCIES.library, [])
})

Deno.test('ZANIX_DEPENDENCY_VERSIONS pins @zanix/core to a published ^2.0.0 range', () => {
  // `@zanix/core@2.0.0` renamed `ConfigOptions.errorLogThrottle` to `ConfigOptions.errors
  // .logThrottle` and moved its logger auto-detect/`notifications` config onto
  // `@zanix/datamaster`/`@zanix/notifications`'s own selector-based env-var renames — no
  // dual-read compat shim on either side, so a project scaffolded against `^1.0.0` would never
  // resolve into a real, currently-published `@zanix/core` release.
  assertEquals(
    ZANIX_DEPENDENCY_VERSIONS['@zanix/core'],
    'jsr:@zanix/core@^3.0.0',
  )
})

Deno.test(
  'ZANIX_DEPENDENCY_VERSIONS pins @zanix/datamaster to the version @zanix/core ' +
    'needs',
  () => {
    assertEquals(
      ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'],
      'jsr:@zanix/datamaster@^1.8.0',
    )
  },
)

Deno.test(
  'ZANIX_DEPENDENCY_VERSIONS pins @zanix/server/graphql to the same version as the bare ' +
    '@zanix/server entry — the version that first carries the ./graphql subpath',
  () => {
    // Derived from the bare `@zanix/server` entry rather than a hardcoded literal: the two are
    // meant to always move together (same real published package, `./graphql` just a subpath of
    // it — see the `@zanix/server/graphql` entry's own comment in `dependencies.ts`), so this stays
    // correct across a version bump instead of needing a matching edit here every time.
    assertEquals(
      ZANIX_DEPENDENCY_VERSIONS['@zanix/server/graphql'],
      `${ZANIX_DEPENDENCY_VERSIONS['@zanix/server']}/graphql`,
    )
  },
)

Deno.test('baseZnxConfig gives server/space/space-server a dev/start task', () => {
  for (const type of ['server', 'space', 'space-server'] as const) {
    const config = baseZnxConfig(type)
    assertEquals(
      typeof config.tasks?.dev,
      'string',
      `${type} should have a dev task`,
    )
    assertEquals(
      typeof config.tasks?.start,
      'string',
      `${type} should have a start task`,
    )
    assertEquals(
      config.tasks?.start?.includes('mod.ts'),
      true,
      `${type}'s start task must target the real entrypoint file`,
    )
  }

  // `dev` differs by type on purpose (see `base.test.ts`'s own, more detailed coverage):
  // `server`'s own generic `deno run --watch` still targets `mod.ts` directly; `space`/
  // `space-server` get `zanix space dev` instead — real HMR, never a bare process restart — which
  // never references `mod.ts` itself (it imports the project's own `space.app.ts`, not `mod.ts`).
  assertEquals(baseZnxConfig('server').tasks?.dev?.includes('mod.ts'), true)
  assertEquals(baseZnxConfig('space').tasks?.dev, 'deno install && zanix space dev')
  assertEquals(baseZnxConfig('space-server').tasks?.dev, 'deno install && zanix space dev')
})

Deno.test('baseZnxConfig gives library/app no dev/start task — no runnable process', () => {
  // `library` has no entrypoint; `app`'s mod.ts is a manifest export only (no top-level `.serve()`
  // call), so a `deno run mod.ts` there would silently do nothing. They still get `check-cycles`/
  // `check-duplicates` — unconditional for every project type (see `baseZnxConfig`'s own doc in
  // `base.ts`), meaningful for a `library`/`app` just as much as a runnable service.
  for (const type of ['library', 'app'] as const) {
    const config = baseZnxConfig(type)
    assertEquals(
      config.tasks?.dev,
      undefined,
      `${type} should not get a dev task`,
    )
    assertEquals(
      config.tasks?.start,
      undefined,
      `${type} should not get a start task`,
    )
    assertEquals(
      config.tasks,
      {
        'check-cycles': 'deno run -A jsr:@zanix/cli check-cycles',
        'check-duplicates': 'deno run -A jsr:@zanix/cli check-duplicates',
      },
      `${type} should only get the check-cycles/check-duplicates tasks`,
    )
  }
})

Deno.test('baseZnxConfig should never hardcode a third-party version inline', () => {
  // Every third-party (non-@zanix/*) import baseZnxConfig ever writes must trace back to
  // THIRD_PARTY_DEPENDENCY_VERSIONS — locks in that `react`'s version (or any future one) can
  // only ever change in one place.
  const config = baseZnxConfig('space')
  const thirdPartyValues = new Set<string>(
    Object.values(THIRD_PARTY_DEPENDENCY_VERSIONS),
  )
  const zanixKeys = new Set(Object.keys(ZANIX_DEPENDENCY_VERSIONS))

  for (const [key, value] of Object.entries(config.imports ?? {})) {
    if (zanixKeys.has(key) || key.endsWith('/')) continue
    assertEquals(
      thirdPartyValues.has(value),
      true,
      `${key} is not in THIRD_PARTY_DEPENDENCY_VERSIONS`,
    )
  }
})
