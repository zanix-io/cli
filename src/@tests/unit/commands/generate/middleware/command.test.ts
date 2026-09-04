import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateMiddlewareAction, { planMiddleware } from 'commands/generate/middleware/command.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(zanixProject: string): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({ zanix: { project: zanixProject } }),
  )
  return projectFolder
}

Deno.test(
  'generateMiddlewareAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'auth'),
        Error,
        "must be run inside a 'server' or 'space-server' project",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateMiddlewareAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateMiddlewareAction.call(
            new Commander(),
            { kind: 'guard' },
            '../../../../victim',
          ),
        Error,
        'path-traversal segment',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateMiddlewareAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateMiddlewareAction.call(new Commander(), { kind: 'guard' }, '123entity'),
        Error,
        "isn't a valid TypeScript identifier",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateMiddlewareAction should throw a clear error when --kind is missing',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateMiddlewareAction.call(new Commander(), {}, 'auth'),
        Error,
        'needs a --kind',
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateMiddlewareAction should throw clearly for an unsupported --kind',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateMiddlewareAction.call(
            new Commander(),
            { kind: 'transformer' },
            'auth',
          ),
        Error,
        "Unsupported middleware kind 'transformer'",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateMiddlewareAction --kind guard writes a guard file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'Auth')

    const middlewarePath = `${projectFolder}/src/shared/middlewares/auth.guard.ts`
    const content = await Deno.readTextFile(middlewarePath)

    assertEquals(content.includes('export const AuthGuard'), true)
    assertEquals(content.includes("defineMiddlewareDecorator(\n  'guard'"), true)
    assertEquals(
      content.includes("import type { GuardContext, GuardResponse } from '@zanix/server'"),
      true,
    )

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/server'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateMiddlewareAction --kind pipe writes a pipe file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateMiddlewareAction.call(
      new Commander(),
      { kind: 'pipe' },
      'Validation',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/shared/middlewares/validation.pipe.ts`,
    )

    assertEquals(content.includes('export const ValidationPipe'), true)
    assertEquals(content.includes("defineMiddlewareDecorator(\n  'pipe'"), true)
    assertEquals(
      content.includes("import type { HandlerContext } from '@zanix/server'"),
      true,
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateMiddlewareAction --kind interceptor writes an interceptor file', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateMiddlewareAction.call(
      new Commander(),
      { kind: 'interceptor' },
      'ResponseHeaders',
    )

    const content = await Deno.readTextFile(
      `${projectFolder}/src/shared/middlewares/response-headers.interceptor.ts`,
    )

    assertEquals(content.includes('export const ResponseHeadersInterceptor'), true)
    assertEquals(content.includes("defineMiddlewareDecorator(\n  'interceptor'"), true)
    assertEquals(
      content.includes('_ctx: HandlerContext, response: Response'),
      true,
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateMiddlewareAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'auth')
    await generateMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'auth')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/shared/middlewares/auth.guard.ts`,
    )
    assertEquals(content.includes('export const AuthGuard'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateMiddlewareAction should never overwrite an existing file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const middlewaresFolder = `${projectFolder}/src/shared/middlewares`
  const middlewarePath = `${middlewaresFolder}/auth.guard.ts`

  try {
    await Deno.mkdir(middlewaresFolder, { recursive: true })
    await Deno.writeTextFile(middlewarePath, '// customized by hand\n')

    await generateMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'auth')

    assertEquals(
      await Deno.readTextFile(middlewarePath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateMiddlewareAction should run deno check against the project when --verify is passed',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    // `--verify` shells out to a real `deno check` via `verifyGeneratedProject` — stubbed here so
    // this test never depends on a real network resolution of the generated file's own imports.
    const commandStub = stub(
      Deno,
      'Command',
      () =>
        ({ output: () => Promise.resolve({ success: true, stderr: new Uint8Array() }) }) as never,
    )

    try {
      await generateMiddlewareAction.call(
        new Commander(),
        { kind: 'guard', verify: true },
        'auth',
      )

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('planMiddleware guard returns a single <name>.guard.ts', () => {
  const { files } = planMiddleware(
    'example',
    'Example',
    'guard',
    '/root/src/shared/middlewares',
  )

  assertEquals(files.map((f) => f.NAME), ['example.guard.ts'])
})

Deno.test('planMiddleware pipe returns a single <name>.pipe.ts', () => {
  const { files } = planMiddleware(
    'example',
    'Example',
    'pipe',
    '/root/src/shared/middlewares',
  )

  assertEquals(files.map((f) => f.NAME), ['example.pipe.ts'])
})

Deno.test('planMiddleware interceptor returns a single <name>.interceptor.ts', () => {
  const { files } = planMiddleware(
    'example',
    'Example',
    'interceptor',
    '/root/src/shared/middlewares',
  )

  assertEquals(files.map((f) => f.NAME), ['example.interceptor.ts'])
})

Deno.test('planMiddleware throws when --kind is missing', () => {
  assertThrows(
    () =>
      planMiddleware(
        'example',
        'Example',
        undefined,
        '/root/src/shared/middlewares',
      ),
    Error,
    'needs a --kind',
  )
})

Deno.test('planMiddleware throws for an unsupported kind', () => {
  assertThrows(
    () =>
      planMiddleware(
        'example',
        'Example',
        'transformer',
        '/root/src/shared/middlewares',
      ),
    Error,
    "Unsupported middleware kind 'transformer'",
  )
})
