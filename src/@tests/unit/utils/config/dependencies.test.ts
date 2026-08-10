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

async function makeProject(imports: Record<string, string> = {}): Promise<string> {
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
  assertEquals(config.imports['@zanix/server'], ZANIX_DEPENDENCY_VERSIONS['@zanix/server'])

  await Deno.remove(root, { recursive: true })
})

Deno.test('ensureZanixDependency should never overwrite an already-declared version', async () => {
  const root = await makeProject({ '@zanix/server': 'jsr:@zanix/server@1.0.0' })

  await ensureZanixDependency(root, '@zanix/server')

  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
  assertEquals(config.imports['@zanix/server'], 'jsr:@zanix/server@1.0.0')

  await Deno.remove(root, { recursive: true })
})

Deno.test('ensureZanixDependency should preserve unrelated existing imports', async () => {
  const root = await makeProject({ 'shared/': './src/shared/' })

  await ensureZanixDependency(root, '@zanix/asyncmq')

  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
  assertEquals(config.imports['shared/'], './src/shared/')
  assertEquals(config.imports['@zanix/asyncmq'], ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq'])

  await Deno.remove(root, { recursive: true })
})

Deno.test('PROJECT_TYPE_DEPENDENCIES should only reference known dependency keys', () => {
  const knownKeys = new Set(Object.keys(ZANIX_DEPENDENCY_VERSIONS))

  for (const [projectType, pkgs] of Object.entries(PROJECT_TYPE_DEPENDENCIES)) {
    for (const pkg of pkgs) {
      assertEquals(knownKeys.has(pkg), true, `${projectType} references unknown package ${pkg}`)
    }
  }
})

Deno.test('PROJECT_TYPE_DEPENDENCIES.library should declare no dependencies', () => {
  assertEquals(PROJECT_TYPE_DEPENDENCIES.library, [])
})

Deno.test('baseZnxConfig gives server/space/space-server a dev/start task', () => {
  for (const type of ['server', 'space', 'space-server'] as const) {
    const config = baseZnxConfig(type)
    assertEquals(typeof config.tasks?.dev, 'string', `${type} should have a dev task`)
    assertEquals(typeof config.tasks?.start, 'string', `${type} should have a start task`)
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
  assertEquals(baseZnxConfig('space').tasks?.dev, 'zanix space dev')
  assertEquals(baseZnxConfig('space-server').tasks?.dev, 'zanix space dev')
})

Deno.test('baseZnxConfig gives library/app no dev/start task — no runnable process', () => {
  // `library` has no entrypoint; `app`'s mod.ts is a manifest export only (no top-level `.serve()`
  // call), so a `deno run mod.ts` there would silently do nothing.
  for (const type of ['library', 'app'] as const) {
    const config = baseZnxConfig(type)
    assertEquals(config.tasks, undefined, `${type} should not get a dev/start task`)
  }
})

Deno.test('baseZnxConfig should never hardcode a third-party version inline', () => {
  // Every third-party (non-@zanix/*) import baseZnxConfig ever writes must trace back to
  // THIRD_PARTY_DEPENDENCY_VERSIONS — locks in that `react`'s version (or any future one) can
  // only ever change in one place.
  const config = baseZnxConfig('space')
  const thirdPartyValues = new Set<string>(Object.values(THIRD_PARTY_DEPENDENCY_VERSIONS))
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
