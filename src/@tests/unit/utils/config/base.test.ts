import { assertEquals } from '@std/assert'
import { baseZnxConfig } from 'utils/config/base.ts'

Deno.test(
  'baseZnxConfig: space/space-server get `zanix space dev`, never the generic watch-reload',
  () => {
    assertEquals(baseZnxConfig('space').tasks?.dev, 'zanix space dev')
    assertEquals(baseZnxConfig('space-server').tasks?.dev, 'zanix space dev')
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
      'deno run --env-file=.env --allow-net --allow-env --allow-read --allow-sys --allow-write --allow-ffi --no-prompt mod.ts',
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
      'deno run --env-file=.env --allow-net --allow-env --allow-read --allow-sys --allow-write --allow-ffi --no-prompt worker.ts',
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
