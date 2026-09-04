import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { discoverRoutes, STDOUT_PAYLOAD_MARKER } from 'commands/generate/openapi/discover.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProjectRoot(): Promise<string> {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(root, { recursive: true })
  return root
}

function stubCommandOutput(
  output: { success: boolean; stdout?: string; stderr?: string },
) {
  const encoder = new TextEncoder()
  return stub(
    Deno,
    'Command',
    () =>
      ({
        output: () =>
          Promise.resolve({
            success: output.success,
            stdout: encoder.encode(output.stdout ?? ''),
            stderr: encoder.encode(output.stderr ?? ''),
          }),
      }) as never,
  )
}

Deno.test('discoverRoutes parses the routes the subprocess prints to stdout', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({
    success: true,
    stdout: STDOUT_PAYLOAD_MARKER +
      JSON.stringify([{ httpMethod: 'GET', path: '/items', application: 'main' }]),
  })

  try {
    const routes = await discoverRoutes(root)
    assertEquals(routes, [{ httpMethod: 'GET', path: '/items', application: 'main' }])
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

// A resolved `@zanix/datamaster` pulls in `jsr:@db/sqlite`, which — with no native binary cached
// yet (always true on a fresh CI runner) — prints its own download progress straight to stdout,
// ahead of the script's real payload. `discoverRoutes` must see straight through that noise to the
// real JSON, not just tolerate a clean stdout — see `STDOUT_PAYLOAD_MARKER`'s own doc in
// `discover.ts`.
Deno.test(
  "discoverRoutes ignores a dependency's own stdout noise ahead of the marked JSON payload",
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: true,
      stdout: 'Downloading https://github.com/denodrivers/sqlite3/releases/.../lib.dylib\n' +
        STDOUT_PAYLOAD_MARKER +
        JSON.stringify([{ httpMethod: 'GET', path: '/items', application: 'main' }]),
    })

    try {
      const routes = await discoverRoutes(root)
      assertEquals(routes, [{ httpMethod: 'GET', path: '/items', application: 'main' }])
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverRoutes throws a clear error when a successful run produced no marked output at all',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({ success: true, stdout: '' })

    try {
      await assertRejects(() => discoverRoutes(root), Error, 'produced no output')
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('discoverRoutes removes its own temp script file after a successful run', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({ success: true, stdout: STDOUT_PAYLOAD_MARKER + '[]' })

  try {
    await discoverRoutes(root)
    const entries = [...(await Array.fromAsync(Deno.readDir(root)))]
    assertEquals(entries.length, 0)
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('discoverRoutes removes its own temp script file after a failed run too', async () => {
  const root = await makeProjectRoot()
  const commandStub = stubCommandOutput({ success: false, stderr: 'something unrelated broke' })

  try {
    await assertRejects(() => discoverRoutes(root))
    const entries = [...(await Array.fromAsync(Deno.readDir(root)))]
    assertEquals(entries.length, 0)
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  'discoverRoutes throws a clear, actionable error when Zanix.compose is unsupported',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({ success: false, stderr: 'ZANIX_COMPOSE_UNSUPPORTED\n' })

    try {
      await assertRejects(
        () => discoverRoutes(root),
        Error,
        'upgrade @zanix/core',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverRoutes throws a clear, actionable error when classMetadata is unsupported',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'ZANIX_CLASS_METADATA_UNSUPPORTED\n',
    })

    try {
      await assertRejects(
        () => discoverRoutes(root),
        Error,
        'upgrade @zanix/utils',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverRoutes throws a clear, actionable error when ProgramModule.routes is unsupported',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'ZANIX_PROGRAM_ROUTES_UNSUPPORTED\n',
    })

    try {
      await assertRejects(
        () => discoverRoutes(root),
        Error,
        'upgrade @zanix/server',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverRoutes surfaces the raw stderr for an unrecognized subprocess failure',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'a real compose-time error in the target project',
    })

    try {
      await assertRejects(
        () => discoverRoutes(root),
        Error,
        'a real compose-time error in the target project',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('discoverRoutes spawns deno run rooted at root, forwarding rootDir', async () => {
  const root = await makeProjectRoot()
  let capturedArgs: unknown
  let capturedOptions: { cwd?: string } | undefined
  const commandStub = stub(
    Deno,
    'Command',
    (_exe: unknown, options: unknown) => {
      capturedOptions = options as { cwd?: string }
      capturedArgs = (options as { args: unknown[] }).args
      return {
        output: () =>
          Promise.resolve({
            success: true,
            stdout: new TextEncoder().encode(STDOUT_PAYLOAD_MARKER + '[]'),
            stderr: new Uint8Array(),
          }),
      } as never
    },
  )

  try {
    await discoverRoutes(root, 'src/server')
    const args = capturedArgs as string[]
    assertEquals(args[0], 'run')
    assertEquals(args.at(-2), 'src/server')
    assertEquals(args.at(-1), '0')
    assert(args.some((arg) => arg.endsWith('.ts')))
    assertEquals(capturedOptions?.cwd, root)
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('discoverRoutes defaults rootDir to "." when omitted', async () => {
  const root = await makeProjectRoot()
  let capturedArgs: string[] = []
  const commandStub = stub(
    Deno,
    'Command',
    (_exe: unknown, options: unknown) => {
      capturedArgs = (options as { args: string[] }).args
      return {
        output: () =>
          Promise.resolve({
            success: true,
            stdout: new TextEncoder().encode(STDOUT_PAYLOAD_MARKER + '[]'),
            stderr: new Uint8Array(),
          }),
      } as never
    },
  )

  try {
    await discoverRoutes(root)
    assertEquals(capturedArgs.at(-2), '.')
    assertEquals(capturedArgs.at(-1), '0')
  } finally {
    commandStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  'discoverRoutes forwards includeAdmin as the final "1"/"0" subprocess argument',
  async () => {
    const root = await makeProjectRoot()
    let capturedArgs: string[] = []
    const commandStub = stub(
      Deno,
      'Command',
      (_exe: unknown, options: unknown) => {
        capturedArgs = (options as { args: string[] }).args
        return {
          output: () =>
            Promise.resolve({
              success: true,
              stdout: new TextEncoder().encode(STDOUT_PAYLOAD_MARKER + '[]'),
              stderr: new Uint8Array(),
            }),
        } as never
      },
    )

    try {
      await discoverRoutes(root, undefined, true)
      assertEquals(capturedArgs.at(-1), '1')
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'discoverRoutes throws a clear, actionable error when { admin: true } is unsupported',
  async () => {
    const root = await makeProjectRoot()
    const commandStub = stubCommandOutput({
      success: false,
      stderr: 'ZANIX_COMPOSE_ADMIN_UNSUPPORTED\n',
    })

    try {
      await assertRejects(
        () => discoverRoutes(root, undefined, true),
        Error,
        'upgrade @zanix/core',
      )
    } finally {
      commandStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
