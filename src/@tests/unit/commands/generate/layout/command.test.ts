import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'
import generateLayoutAction, { registerLayoutCommand } from 'commands/generate/layout/command.ts'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(
  zanixProject: string,
  renderer?: 'react' | 'preact',
): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({
      zanix: { project: zanixProject },
      // The renderer is derived from `compilerOptions.jsxImportSource` — the compile-time
      // projection `zanix new space --renderer=...` already writes, never a config knob of its own.
      // See `getProjectRenderer`'s own doc for why a dedicated field was rejected.
      ...(renderer ? { compilerOptions: { jsx: 'react-jsx', jsxImportSource: renderer } } : {}),
    }),
  )
  return projectFolder
}

/** Reads a generated layout file for the given route path. `''` is the ROOT layout. */
async function readLayout(projectFolder: string, routePath: string): Promise<string> {
  return await Deno.readTextFile(
    `${projectFolder}/src/space/routes/${routePath}/layout.tsx`.replace('routes//', 'routes/'),
  )
}

Deno.test('generateLayoutAction should throw outside a space/space-server project', async () => {
  const projectFolder = await makeProject('server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => generateLayoutAction.call(new Commander(), {}, 'products'),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLayoutAction should write a real, correctly-shaped layout file', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateLayoutAction.call(new Commander(), {}, 'products')

    const layoutPath = `${projectFolder}/src/space/routes/products/layout.tsx`
    const content = await Deno.readTextFile(layoutPath)

    assertEquals(
      content.includes("import type { LayoutProps } from '@zanix/space'"),
      true,
    )
    assertEquals(
      content.includes(
        'export default function ProductsLayout({ children }: LayoutProps)',
      ),
      true,
    )

    const config = JSON.parse(
      await Deno.readTextFile(`${projectFolder}/deno.jsonc`),
    )
    assertEquals(
      config.imports['@zanix/space'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLayoutAction should work at the root route path too', async () => {
  const projectFolder = await makeProject('space-server')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await generateLayoutAction.call(new Commander(), {}, '')

    const content = await Deno.readTextFile(
      `${projectFolder}/src/space/routes/layout.tsx`,
    )
    assertEquals(content.includes('export default function IndexLayout'), true)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test('generateLayoutAction should never overwrite an existing layout', async () => {
  const projectFolder = await makeProject('space')
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  const routeFolder = `${projectFolder}/src/space/routes/products`
  const layoutPath = `${routeFolder}/layout.tsx`

  try {
    await Deno.mkdir(routeFolder, { recursive: true })
    await Deno.writeTextFile(layoutPath, '// customized by hand\n')

    await generateLayoutAction.call(new Commander(), {}, 'products')

    assertEquals(
      await Deno.readTextFile(layoutPath),
      '// customized by hand\n',
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})

Deno.test(
  'registerLayoutCommand should wire the real actionHandler to generateLayoutAction',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)
    const cwd = new Commander()
    registerLayoutCommand(cwd)
    type ActionCommand = { actionHandler: (options: unknown, ...args: unknown[]) => Promise<void> }
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    try {
      await command.actionHandler({}, 'wired')

      const content = await Deno.readTextFile(
        `${projectFolder}/src/space/routes/wired/layout.tsx`,
      )
      assertEquals(content.includes('export default function WiredLayout'), true)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateLayoutAction should run deno check against the project when --verify is passed',
  async () => {
    const projectFolder = await makeProject('space')
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
      await generateLayoutAction.call(new Commander(), { verify: true }, 'products')

      assertEquals(commandStub.calls.length, 1)
    } finally {
      commandStub.restore()
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

// ================================================================================================
// Root vs nested, and the renderer the project actually declared.
//
// `@zanix/space` replaces its own default document shell with whatever a ROOT layout renders, and
// deliberately never checks that it rendered a real document. Emitting the nested `<div>` shape at
// the root therefore produced pages with no doctype, no `lang`, no charset and no viewport — a
// silent regression caused by this generator itself.
// ================================================================================================

Deno.test(
  'generateLayoutAction: a ROOT layout owns the document — html/lang, head, charset, viewport, body',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateLayoutAction.call(new Commander(), {}, '')
      const source = await readLayout(projectFolder, '')

      assertStringIncludes(source, "<html lang='en'>")
      assertStringIncludes(source, '<head>')
      assertStringIncludes(source, "<meta charSet='utf-8' />")
      assertStringIncludes(source, "content='width=device-width, initial-scale=1'")
      assertStringIncludes(source, '<body>{children}</body>')
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  "generateLayoutAction: a ROOT layout's viewport never blocks zoom — user-scalable=no or " +
    'maximum-scale below 2 is a real WCAG 1.4.4 (AA) failure under ACT rule b4f0c3',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateLayoutAction.call(new Commander(), {}, '')
      const source = await readLayout(projectFolder, '')
      assertEquals(source.includes('user-scalable'), false)
      assertEquals(source.includes('maximum-scale'), false)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateLayoutAction: a NESTED layout stays a plain wrapper — it does not own the document',
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateLayoutAction.call(new Commander(), {}, 'products')
      const source = await readLayout(projectFolder, 'products')
      assertStringIncludes(source, '<div>{children}</div>')
      assertEquals(source.includes('<html'), false)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  "generateLayoutAction: a ROOT layout in a PREACT project types children with Preact's own " +
    'ComponentChildren — derived from compilerOptions.jsxImportSource, the same single choice ' +
    'defineSpaceApp({ renderer }) expresses, never a second independent setting',
  async () => {
    const projectFolder = await makeProject('space', 'preact')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateLayoutAction.call(new Commander(), {}, '')
      const source = await readLayout(projectFolder, '')
      assertStringIncludes(source, "import type { ComponentChildren } from 'preact'")
      assertStringIncludes(source, 'LayoutProps<ComponentChildren>')
      // Still the same document, in both renderers.
      assertStringIncludes(source, "<html lang='en'>")
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateLayoutAction: a project with no jsxImportSource is treated as react — matching ' +
    "defineSpaceApp({ renderer })'s own documented default",
  async () => {
    const projectFolder = await makeProject('space')
    const mockCwd = stub(Deno, 'cwd', () => projectFolder)

    try {
      await generateLayoutAction.call(new Commander(), {}, '')
      const source = await readLayout(projectFolder, '')
      assertEquals(source.includes('preact'), false)
    } finally {
      mockCwd.restore()
      await Deno.remove(projectFolder, { recursive: true })
    }
  },
)

Deno.test(
  'generateLayoutAction: NO generated layout receives or renders a head-related prop — the root ' +
    'layout must never have to cooperate for the document to carry its own metadata. An earlier ' +
    'design passed a headExtras prop that a Preact root layout had to render, and a layout that ' +
    'ignored it served every page with no title, canonical or stylesheet links',
  async () => {
    for await (const renderer of ['react', 'preact'] as const) {
      const projectFolder = await makeProject('space', renderer)
      const mockCwd = stub(Deno, 'cwd', () => projectFolder)

      try {
        await generateLayoutAction.call(new Commander(), {}, '')
        await generateLayoutAction.call(new Commander(), {}, 'products')
        for await (const routePath of ['', 'products']) {
          const source = await readLayout(projectFolder, routePath)
          assertEquals(source.includes('headExtras'), false, `${renderer} ${routePath}`)
          assertEquals(source.includes('<title'), false, `${renderer} ${routePath}`)
        }
      } finally {
        mockCwd.restore()
        await Deno.remove(projectFolder, { recursive: true })
      }
    }
  },
)
