import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateGlobalMiddlewareAction, {
  planGlobalMiddleware,
} from 'commands/generate/globalmiddleware/command.ts'
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
  'generateGlobalMiddlewareAction should throw outside a server/space-server project',
  async () => {
    const projectFolder = await makeProject('library')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateGlobalMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'audit'),
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
  'generateGlobalMiddlewareAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateGlobalMiddlewareAction.call(
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
  'generateGlobalMiddlewareAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateGlobalMiddlewareAction.call(new Commander(), { kind: 'guard' }, '123entity'),
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
  'generateGlobalMiddlewareAction should throw a clear error when --kind is missing',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () => generateGlobalMiddlewareAction.call(new Commander(), {}, 'audit'),
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
  'generateGlobalMiddlewareAction should throw clearly for an unsupported --kind',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateGlobalMiddlewareAction.call(
            new Commander(),
            { kind: 'transformer' },
            'audit',
          ),
        Error,
        "Unsupported global middleware kind 'transformer'",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateGlobalMiddlewareAction --kind pipe writes a pipe .defs.ts file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateGlobalMiddlewareAction.call(new Commander(), { kind: 'pipe' }, 'Audit')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/shared/middlewares/audit.pipe.defs.ts`,
    )

    assertEquals(content.includes('const AuditPipe: MiddlewareGlobalPipe'), true)
    assertEquals(content.includes('registerGlobalPipe(AuditPipe)'), true)
    assertEquals(
      content.includes("import { registerGlobalPipe } from '@zanix/server'"),
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

Deno.test('generateGlobalMiddlewareAction --kind guard writes a guard .defs.ts file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateGlobalMiddlewareAction.call(new Commander(), { kind: 'guard' }, 'Audit')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/shared/middlewares/audit.guard.defs.ts`,
    )

    assertEquals(content.includes('const AuditGuard: MiddlewareGlobalGuard'), true)
    assertEquals(content.includes('registerGlobalGuard(AuditGuard)'), true)
    assertEquals(
      content.includes("import { registerGlobalGuard } from '@zanix/server'"),
      true,
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateGlobalMiddlewareAction --kind interceptor writes an interceptor .defs.ts file',
  async () => {
    const projectFolder = await makeProject('space-server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateGlobalMiddlewareAction.call(
        new Commander(),
        { kind: 'interceptor' },
        'Audit',
      )

      const content = await Deno.readTextFile(
        `${projectFolder}/src/shared/middlewares/audit.interceptor.defs.ts`,
      )

      assertEquals(content.includes('const AuditInterceptor: MiddlewareGlobalInterceptor'), true)
      assertEquals(content.includes('registerGlobalInterceptor(AuditInterceptor)'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateGlobalMiddlewareAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateGlobalMiddlewareAction.call(new Commander(), { kind: 'pipe' }, 'audit')
    await generateGlobalMiddlewareAction.call(new Commander(), { kind: 'pipe' }, 'audit')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/shared/middlewares/audit.pipe.defs.ts`,
    )
    assertEquals(content.includes('registerGlobalPipe(AuditPipe)'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateGlobalMiddlewareAction should never overwrite an existing file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const middlewaresFolder = `${projectFolder}/src/shared/middlewares`
  const middlewarePath = `${middlewaresFolder}/audit.pipe.defs.ts`

  try {
    await Deno.mkdir(middlewaresFolder, { recursive: true })
    await Deno.writeTextFile(middlewarePath, '// customized by hand\n')

    await generateGlobalMiddlewareAction.call(new Commander(), { kind: 'pipe' }, 'audit')

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
  'generateGlobalMiddlewareAction should run deno check against the project when --verify is passed',
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
      await generateGlobalMiddlewareAction.call(
        new Commander(),
        { kind: 'pipe', verify: true },
        'audit',
      )

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('planGlobalMiddleware pipe returns a single <name>.pipe.defs.ts', () => {
  const { files } = planGlobalMiddleware(
    'example',
    'Example',
    'pipe',
    '/root/src/shared/middlewares',
  )

  assertEquals(files.map((f) => f.NAME), ['example.pipe.defs.ts'])
})

Deno.test('planGlobalMiddleware guard returns a single <name>.guard.defs.ts', () => {
  const { files } = planGlobalMiddleware(
    'example',
    'Example',
    'guard',
    '/root/src/shared/middlewares',
  )

  assertEquals(files.map((f) => f.NAME), ['example.guard.defs.ts'])
})

Deno.test('planGlobalMiddleware interceptor returns a single <name>.interceptor.defs.ts', () => {
  const { files } = planGlobalMiddleware(
    'example',
    'Example',
    'interceptor',
    '/root/src/shared/middlewares',
  )

  assertEquals(files.map((f) => f.NAME), ['example.interceptor.defs.ts'])
})

Deno.test('planGlobalMiddleware throws when --kind is missing', () => {
  assertThrows(
    () =>
      planGlobalMiddleware(
        'example',
        'Example',
        undefined,
        '/root/src/shared/middlewares',
      ),
    Error,
    'needs a --kind',
  )
})

Deno.test('planGlobalMiddleware throws for an unsupported kind', () => {
  assertThrows(
    () =>
      planGlobalMiddleware(
        'example',
        'Example',
        'transformer',
        '/root/src/shared/middlewares',
      ),
    Error,
    "Unsupported global middleware kind 'transformer'",
  )
})
