import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateRtoAction, { planRto } from 'commands/generate/rto/command.ts'
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

Deno.test('generateRtoAction should throw outside a server/space-server project', async () => {
  const projectFolder = await makeProject('library')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () =>
        generateRtoAction.call(
          new Commander(),
          { field: ['name:string'] },
          'payment',
        ),
      Error,
      "must be run inside a 'server' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateRtoAction should reject a name containing a ".." path-traversal segment',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateRtoAction.call(
            new Commander(),
            { field: ['name:string'] },
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
  'generateRtoAction should reject a name that produces an invalid TS identifier',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateRtoAction.call(
            new Commander(),
            { field: ['name:string'] },
            '123entity',
          ),
        Error,
        "isn't a valid TypeScript identifier",
      )
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateRtoAction should throw a clear error when no --field is given', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateRtoAction.call(new Commander(), {}, 'payment'),
      Error,
      'needs at least one --field',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateRtoAction should throw a clear error and write nothing when --field names collide',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await assertRejects(
        () =>
          generateRtoAction.call(
            new Commander(),
            { field: ['total:number', 'total:string'] },
            'invoice',
          ),
        Error,
        "Duplicate --field name(s): 'total' (given 2 times)",
      )

      const rtosFolder = `${projectFolder}/src/server/handlers/rtos`
      await assertRejects(() => Deno.stat(`${rtosFolder}/invoice.rto.ts`))
      await assertRejects(() => Deno.stat(rtosFolder))
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateRtoAction writes RTO with a real IsObjectID import, no local file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRtoAction.call(
      new Commander(),
      { field: ['amount:number', 'currencyId:objectId'] },
      'PaymentMethod',
    )

    const rtosFolder = `${projectFolder}/src/server/handlers/rtos`
    const rto = await Deno.readTextFile(`${rtosFolder}/payment-method.rto.ts`)
    assert(rto.includes('export class PaymentMethodRTO'))
    assert(rto.includes('accessor amount!: number'))
    assert(rto.includes("IsObjectID, IsString } from '@zanix/validator'"))

    // `objectId` renders a real `@zanix/validator` import — no more local `IsObjectID.ts`/
    // `OBJECTID_REGEX` (see `rto/renderer.ts`'s own doc).
    await assertRejects(() => Deno.stat(`${rtosFolder}/validations/IsObjectID.ts`))
    await assertRejects(() => Deno.stat(`${rtosFolder}/validations/IsPermission.ts`))
    await assertRejects(() => Deno.stat(`${projectFolder}/src/utils/constants.ts`))

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/validator'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/validator'],
    )
    assertEquals(
      config.imports['@zanix/datamaster'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'generateRtoAction writes a permission field as plain IsString, no local file',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateRtoAction.call(
        new Commander(),
        { field: ['grantedBy:permission'] },
        'Role',
      )

      const rtosFolder = `${projectFolder}/src/server/handlers/rtos`
      const rto = await Deno.readTextFile(`${rtosFolder}/role.rto.ts`)
      assert(rto.includes('@IsString({ expose: true })\n  accessor grantedBy!: string'))
      assert(!rto.includes('IsPermission'))

      // No hand-rolled validator/constant is ever generated for `permission` anymore — see
      // `renderer.ts`'s own doc for why a dedicated `IsPermission` was removed rather than
      // replaced.
      await assertRejects(() => Deno.stat(`${rtosFolder}/validations/IsPermission.ts`))
      await assertRejects(() => Deno.stat(`${projectFolder}/src/utils/constants.ts`))
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateRtoAction with only objectId/permission fields never creates constants.ts',
  async () => {
    const projectFolder = await makeProject('server')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateRtoAction.call(
        new Commander(),
        { field: ['id:objectId', 'scope:permission'] },
        'Thing',
      )

      await assertRejects(() => Deno.stat(`${projectFolder}/src/utils/constants.ts`))
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test('generateRtoAction should be idempotent when run twice', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateRtoAction.call(
      new Commander(),
      { field: ['name:string'] },
      'invoice',
    )
    await generateRtoAction.call(
      new Commander(),
      { field: ['name:string'] },
      'invoice',
    )

    const rto = await Deno.readTextFile(
      `${projectFolder}/src/server/handlers/rtos/invoice.rto.ts`,
    )
    assert(rto.includes('export class InvoiceRTO'))
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateRtoAction should never overwrite an existing RTO file', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const rtosFolder = `${projectFolder}/src/server/handlers/rtos`
  const rtoPath = `${rtosFolder}/invoice.rto.ts`

  try {
    await Deno.mkdir(rtosFolder, { recursive: true })
    await Deno.writeTextFile(rtoPath, '// customized by hand\n')

    await generateRtoAction.call(
      new Commander(),
      { field: ['name:string'] },
      'invoice',
    )

    assertEquals(await Deno.readTextFile(rtoPath), '// customized by hand\n')
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('planRto without any fields returns only rto.ts', () => {
  const { files } = planRto(
    'example',
    'Example',
    [],
    '/root/src/server/handlers/rtos',
  )

  assertEquals(files.map((f) => f.NAME), ['example.rto.ts'])
})

Deno.test('planRto with a permission field still returns only rto.ts', () => {
  // No dedicated local file exists for `permission` anymore — it renders a plain `IsString`, same
  // as `string` — see `renderer.ts`'s own doc for the full investigation.
  const { files } = planRto(
    'role',
    'Role',
    [{
      name: 'grantedBy',
      type: 'permission',
      optional: false,
      isArray: false,
    }],
    '/root/src/server/handlers/rtos',
  )

  assertEquals(files.map((f) => f.NAME), ['role.rto.ts'])
})

Deno.test(
  'planRto.ensureConstants is a permanent no-op (no field type needs a generated constant anymore)',
  async () => {
    const projectFolder = await makeProject('server')

    try {
      await planRto(
        'role',
        'Role',
        [{ name: 'grantedBy', type: 'permission', optional: false, isArray: false }],
        `${projectFolder}/src/server/handlers/rtos`,
      )
        .ensureConstants(projectFolder)

      await assertRejects(() => Deno.stat(`${projectFolder}/src/utils/constants.ts`))
    } finally {
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  "getServerSrcTree's rto leaf uses planRto, so its file list never drifts from zanix generate rto",
  async () => {
    const { getServerSrcTree } = await import(
      'commands/new/lib/tree/projects/server.ts'
    )
    const tree = getServerSrcTree(`${temporaryFolder}/${crypto.randomUUID()}`)
    const rtoFiles = tree.subfolders.handlers.subfolders.rtos.templates.base

    // `planRto` never generates more than the one `<name>.rto.ts` file today, regardless of
    // fields — same rule `zanix generate rto` itself follows (see `planRto`'s own doc).
    assertEquals(rtoFiles.map((f) => f.NAME), ['example.rto.ts'])
  },
)
