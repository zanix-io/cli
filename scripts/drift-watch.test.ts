import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import {
  checkProject,
  fetchLatestVersion,
  parseSpecifier,
  rewriteToLatestVersions,
  run,
} from './drift-watch.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

Deno.test('parseSpecifier parses a plain package specifier', () => {
  assertEquals(parseSpecifier('jsr:@zanix/server@^3.1.0'), {
    pkg: '@zanix/server',
    subpath: '',
  })
})

Deno.test('parseSpecifier parses a specifier with a version range using *', () => {
  assertEquals(parseSpecifier('jsr:@zanix/utils@2.*'), {
    pkg: '@zanix/utils',
    subpath: '',
  })
})

Deno.test('parseSpecifier parses a subpath alias specifier', () => {
  assertEquals(
    parseSpecifier('jsr:@zanix/utils@2.*/validator'),
    { pkg: '@zanix/utils', subpath: '/validator' },
  )
})

Deno.test('parseSpecifier parses a nested subpath', () => {
  assertEquals(
    parseSpecifier('jsr:@zanix/app@^0.1.0/runtime'),
    { pkg: '@zanix/app', subpath: '/runtime' },
  )
})

Deno.test('parseSpecifier throws for a non-jsr specifier', () => {
  assertThrows(
    () => parseSpecifier('npm:react@^19.2.0'),
    Error,
    'Cannot parse specifier',
  )
})

Deno.test(
  'run resolves success:true and captures real stdout for a successful command',
  async () => {
    const { success, output } = await run([
      Deno.execPath(),
      'eval',
      'console.log("drift-watch-run-ok")',
    ])

    assertEquals(success, true)
    assertEquals(output.includes('drift-watch-run-ok'), true)
  },
)

Deno.test('run resolves success:false for a real, non-zero-exit command', async () => {
  const { success } = await run([Deno.execPath(), 'eval', 'Deno.exit(1)'])

  assertEquals(success, false)
})

Deno.test(
  'fetchLatestVersion fetches at most once per package — a second call is a pure cache hit',
  async () => {
    const pkg = `@drift-test/${crypto.randomUUID()}`
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => Promise.resolve(new Response(JSON.stringify({ latest: '9.9.9' }), { status: 200 })),
    )

    try {
      await fetchLatestVersion(pkg)
      await fetchLatestVersion(pkg)

      assertEquals(fetchStub.calls.length, 1)
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'rewriteToLatestVersions rewrites only the entries that resolve a real latest version, ' +
    'leaving everything else (unresolvable packages, non-ZANIX_DEPENDENCY_VERSIONS keys) untouched',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const found = `@drift-test/${crypto.randomUUID()}`
    const noLatestField = `@drift-test/${crypto.randomUUID()}`
    const notOk = `@drift-test/${crypto.randomUUID()}`
    const throwsPkg = `@drift-test/${crypto.randomUUID()}`

    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        imports: {
          '@zanix/server': `jsr:${found}@^1.0.0`,
          '@zanix/app': `jsr:${noLatestField}@^1.0.0`,
          '@zanix/core': `jsr:${notOk}@^1.0.0`,
          '@zanix/datamaster': `jsr:${throwsPkg}@^1.0.0`,
          // Not a key `ZANIX_DEPENDENCY_VERSIONS` knows about — must stay untouched regardless of
          // what its own value resolves to.
          'unrelated-pkg': `jsr:${found}@^1.0.0`,
        },
      }),
    )

    const fetchStub = stub(globalThis, 'fetch', (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes(found)) {
        return Promise.resolve(
          new Response(JSON.stringify({ latest: '2.5.0' }), { status: 200 }),
        )
      }
      if (url.includes(noLatestField)) {
        // `ok: true` but no `latest` field at all — exercises the `?? null` fallback.
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      }
      if (url.includes(notOk)) {
        return Promise.resolve(new Response(null, { status: 404 }))
      }
      if (url.includes(throwsPkg)) {
        return Promise.reject(new Error('network down'))
      }
      throw new Error(`unexpected fetch call in this test: ${url}`)
    })

    try {
      await rewriteToLatestVersions(root)

      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
      assertEquals(config.imports['@zanix/server'], `jsr:${found}@2.5.0`)
      assertEquals(config.imports['@zanix/app'], `jsr:${noLatestField}@^1.0.0`)
      assertEquals(config.imports['@zanix/core'], `jsr:${notOk}@^1.0.0`)
      assertEquals(config.imports['@zanix/datamaster'], `jsr:${throwsPkg}@^1.0.0`)
      assertEquals(config.imports['unrelated-pkg'], `jsr:${found}@^1.0.0`)
    } finally {
      fetchStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'rewriteToLatestVersions tolerates a deno.json with no imports field at all',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ name: 'no-imports-here' }))

    try {
      await rewriteToLatestVersions(root)

      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`))
      assertEquals(config.imports, {})
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'checkProject returns success without ever spawning deno check when there are no .ts/.tsx files',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ imports: {} }))

    const commandStub = stub(
      Deno,
      'Command',
      (() => {
        throw new Error('deno check should never be spawned when there are no .ts/.tsx files')
      }) as never,
    )

    try {
      const result = await checkProject('empty', root)

      assertEquals(result, { name: 'empty', success: true, output: '(no .ts/.tsx files)' })
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('checkProject runs deno check against every collected .ts/.tsx file', async () => {
  const root = await Deno.makeTempDir({ dir: temporaryFolder })
  await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify({ imports: {} }))
  await Deno.writeTextFile(`${root}/mod.ts`, 'export const x = 1\n')

  const commandStub = stub(
    Deno,
    'Command',
    () =>
      ({
        output: () =>
          Promise.resolve({
            success: true,
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
          }),
      }) as never,
  )

  try {
    const result = await checkProject('with-file', root)

    assertEquals(result.success, true)
    assertEquals(commandStub.calls.length, 1)
    const [cmd, opts] = commandStub.calls[0].args as [string, { args: string[] }]
    assertEquals(cmd, 'deno')
    assertEquals(opts.args[0], 'check')
    assertEquals(opts.args[1], `${root}/mod.ts`)
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})
