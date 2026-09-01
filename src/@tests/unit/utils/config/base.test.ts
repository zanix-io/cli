import { assertEquals } from '@std/assert'
import { baseZnxConfig, INITIAL_PROJECT_VERSION, RUN_PERMISSIONS } from 'utils/config/base.ts'
import type { ZanixProjects } from '@zanix/types'

Deno.test(
  'baseZnxConfig: space/space-server get `deno install && zanix space dev`, never the generic ' +
    'watch-reload — `deno install` runs first so Vite never hits an unresolved npm-backed import ' +
    "(e.g. react-dom) on a fresh scaffold's very first run",
  () => {
    assertEquals(baseZnxConfig('space').tasks?.dev, 'deno install && zanix space dev')
    assertEquals(baseZnxConfig('space-server').tasks?.dev, 'deno install && zanix space dev')
  },
)

Deno.test(
  'baseZnxConfig: server keeps the generic deno run --watch dev task, unaffected',
  () => {
    assertEquals(
      baseZnxConfig('server').tasks?.dev,
      'deno check && deno run --watch --env-file=.env -A mod.ts',
    )
  },
)

Deno.test(
  'baseZnxConfig: start is identical in shape for every runnable type — zanix space dev is dev-only, never a substitute for production',
  () => {
    const spaceStart = baseZnxConfig('space').tasks?.start
    const serverStart = baseZnxConfig('server').tasks?.start
    const spaceServerStart = baseZnxConfig('space-server').tasks?.start

    assertEquals(spaceStart, spaceServerStart)
    assertEquals(
      spaceStart,
      `deno run --env-file=.env ${RUN_PERMISSIONS} mod.ts`,
    )
    assertEquals(serverStart, spaceStart)
  },
)

Deno.test('baseZnxConfig: library/app have no runnable entrypoint, so no tasks at all', () => {
  assertEquals(baseZnxConfig('library').tasks, undefined)
  assertEquals(baseZnxConfig('app').tasks, undefined)
})

Deno.test(
  'baseZnxConfig: server/space-server get a worker task pointed at worker.ts, same permissions as start',
  () => {
    assertEquals(
      baseZnxConfig('server').tasks?.worker,
      `deno run --env-file=.env ${RUN_PERMISSIONS} worker.ts`,
    )
    assertEquals(
      baseZnxConfig('space-server').tasks?.worker,
      baseZnxConfig('server').tasks?.worker,
    )
  },
)

Deno.test('baseZnxConfig: plain space has no worker task — no @zanix/core dependency', () => {
  assertEquals(baseZnxConfig('space').tasks?.worker, undefined)
})

Deno.test(
  'baseZnxConfig: renderer omitted defaults to react — identical to passing it explicitly',
  () => {
    const omitted = baseZnxConfig('space')
    const explicit = baseZnxConfig('space', 'react')
    assertEquals(omitted, explicit)
    assertEquals(omitted.compilerOptions?.jsxImportSource, 'react')
    assertEquals(omitted.imports?.react, 'npm:react@^19.2.0')
    assertEquals(omitted.imports?.preact, undefined)
  },
)

Deno.test(
  "baseZnxConfig: renderer 'preact' swaps jsxImportSource and the declared npm dependency, " +
    'never declaring both react and preact at once',
  () => {
    const config = baseZnxConfig('space', 'preact')
    assertEquals(config.compilerOptions?.jsxImportSource, 'preact')
    assertEquals(config.imports?.preact, 'npm:preact@^10.29.0')
    assertEquals(config.imports?.react, undefined)
  },
)

Deno.test(
  "baseZnxConfig: renderer 'preact' also declares preact/hooks — a plain hand-written subpath " +
    "import (--theme astronaut's own comet demo uses it), unlike the compiler-mediated " +
    'jsx-runtime import, needs its own explicit import-map entry or a freshly generated ' +
    "'--renderer preact' project fails outright the moment anything imports it",
  () => {
    const config = baseZnxConfig('space', 'preact')
    assertEquals(config.imports?.['preact/hooks'], 'npm:preact@^10.29.0/hooks')

    const reactConfig = baseZnxConfig('space', 'react')
    assertEquals(reactConfig.imports?.['preact/hooks'], undefined)
  },
)

Deno.test(
  'baseZnxConfig: renderer applies the same way to space-server as it does to plain space',
  () => {
    const config = baseZnxConfig('space-server', 'preact')
    assertEquals(config.compilerOptions?.jsxImportSource, 'preact')
    assertEquals(config.imports?.preact, 'npm:preact@^10.29.0')
  },
)

Deno.test(
  'baseZnxConfig: renderer is ignored for project types that never carry @zanix/space at all',
  () => {
    const config = baseZnxConfig('server', 'preact')
    assertEquals(config.compilerOptions?.jsxImportSource, undefined)
    assertEquals(config.imports?.preact, undefined)
    assertEquals(config.imports?.react, undefined)
  },
)

Deno.test(
  'baseZnxConfig: every project type gets a real, valid-shaped version field — deno publish ' +
    "--dry-run fails outright without one, regardless of a type's own publish block",
  () => {
    const types: ZanixProjects[] = ['app', 'library', 'server', 'space', 'space-server']
    for (const type of types) {
      assertEquals(baseZnxConfig(type).version, INITIAL_PROJECT_VERSION)
    }
    assertEquals(INITIAL_PROJECT_VERSION, '0.1.0')
  },
)

Deno.test(
  "baseZnxConfig: name's package-name half is the real project name (root's basename), " +
    'never the old hardcoded literal — scope half stays an unmistakable placeholder',
  () => {
    assertEquals(baseZnxConfig('library', 'react', 'my-lib').name, '@your-scope/my-lib')
    assertEquals(baseZnxConfig('app', 'react', 'my-app').name, '@your-scope/my-app')
    // A nested/absolute root (e.g. an isolated temp dir) only ever contributes its basename.
    assertEquals(
      baseZnxConfig('library', 'react', '/tmp/some/nested/mylib').name,
      '@your-scope/mylib',
    )
  },
)

Deno.test(
  'baseZnxConfig: name falls back to an unmistakable placeholder leaf when root is omitted',
  () => {
    assertEquals(baseZnxConfig('library').name, '@your-scope/name')
  },
)
