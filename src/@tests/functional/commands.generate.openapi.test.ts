import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'

const temporaryFolder = getTemporaryFolder(import.meta.url)

/**
 * `zanix generate openapi` is the one generator that actually EXECUTES the target project's own
 * code (a real `deno run` subprocess, see `discover.ts`) instead of only writing files — these
 * tests run the real CLI binary against a real, freshly scaffolded project, proving the whole
 * pipeline (CLI → subprocess → real route discovery → `openapi.json`) end-to-end, not just the
 * pure functions in isolation.
 *
 * `@zanix/core@^2.0.0` (`Zanix.compose`), `@zanix/server`'s `ProgramModule.routes` (published since
 * `3.3.0`, resolved here via `cli`'s own `^3.0.0` floor), and `classMetadata` (published since
 * `@zanix/utils@3.0.1`, resolved via `cli`'s own `@zanix/validator` `^3.0.0` floor) are now all real,
 * currently-published dependencies — a freshly scaffolded `server` project's `deno run` resolves
 * every one of `discover.ts`'s three sentinels as satisfied, so the real, currently reachable
 * outcome is a populated `openapi.json`, not a graceful "upgrade @zanix/core" error. These tests
 * assert that real success path end-to-end; `discover.ts`'s own sentinel-error behavior stays
 * covered by `src/@tests/unit/commands/generate/openapi/discover.test.ts`'s stubbed-subprocess
 * cases, which exercise each sentinel directly rather than depending on a real dependency ever
 * NOT publishing a feature.
 */

Deno.test(
  'generate openapi succeeds against a real project — @zanix/core/@zanix/server/@zanix/utils ' +
    'all publish real route-introspection support now',
  async () => {
    const project = `${temporaryFolder}/openapi-project`
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] }).output()

    const { code, stderr } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'openapi', project],
    }).output()

    assertEquals(code, 0, new TextDecoder().decode(stderr))
    assert(fileExists(`${project}/openapi.json`))

    const spec = JSON.parse(await Deno.readTextFile(`${project}/openapi.json`))
    assertEquals(spec.openapi, '3.0.3')
    assert(
      spec.paths['/example/list']?.get?.tags?.includes('main'),
      "the scaffold's own real example route must be discovered",
    )

    await Deno.remove(project, { recursive: true })
  },
)

Deno.test(
  'generate openapi --application filters real discovered routes down to just that application',
  async () => {
    const project = `${temporaryFolder}/openapi-application-project`
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] }).output()

    const { code, stderr } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'openapi', '--application', 'main', project],
    }).output()

    assertEquals(code, 0, new TextDecoder().decode(stderr))

    const spec = JSON.parse(await Deno.readTextFile(`${project}/openapi.json`))
    assert(spec.paths['/example/list']?.get?.tags?.includes('main'))

    await Deno.remove(project, { recursive: true })
  },
)

Deno.test(
  "generate openapi --include-admin also discovers @zanix/admin's built-in admin routes",
  async () => {
    const project = `${temporaryFolder}/openapi-include-admin-project`
    await new Deno.Command('deno', { args: ['run', 'new', 'server', project] }).output()

    const { code, stderr } = await new Deno.Command('deno', {
      args: ['run', 'generate', 'openapi', '--include-admin', project],
    }).output()

    assertEquals(code, 0, new TextDecoder().decode(stderr))

    const spec = JSON.parse(await Deno.readTextFile(`${project}/openapi.json`))
    assert(spec.paths['/example/list']?.get?.tags?.includes('main'))
    assert(
      spec.paths['/admin/service-token']?.post?.tags?.includes('admin'),
      '--include-admin must surface the admin-Application routes @zanix/compose registers',
    )

    await Deno.remove(project, { recursive: true })
  },
)

Deno.test('generate openapi fails clearly outside a server/space-server project', async () => {
  const project = `${temporaryFolder}/openapi-library-project`
  await new Deno.Command('deno', { args: ['run', 'new', 'library', project] }).output()

  const { code } = await new Deno.Command('deno', {
    args: ['run', 'generate', 'openapi', project],
  }).output()

  assertEquals(code, 1)
  assert(!fileExists(`${project}/openapi.json`))

  await Deno.remove(project, { recursive: true })
})
