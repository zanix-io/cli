import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { getProjectRenderer } from 'commands/generate/shared/project.ts'
import { baseZnxConfig } from 'utils/config/base.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// ================================================================================================
// ONE knob for React vs Preact.
//
// A project selects its renderer in exactly one place: `defineSpaceApp({ renderer })`. Everything
// else is a projection of that single choice, written from the same `--renderer` flag by
// `zanix new space`. `getProjectRenderer` DERIVES from one of those projections
// (`compilerOptions.jsxImportSource`) rather than reading a config field of its own, so there is
// nothing that can drift out of agreement.
//
// A dedicated `zanix.renderer` field existed briefly and was removed: it was a genuinely
// independent value answering a question that already had an answer, with nothing forcing the two
// back into agreement. These tests exist so it does not come back by accident.
// ================================================================================================

async function writeConfig(config: unknown): Promise<string> {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(projectFolder, { recursive: true })
  await Deno.writeTextFile(`${projectFolder}/deno.jsonc`, JSON.stringify(config))
  return projectFolder
}

async function rendererFor(config: unknown): Promise<string> {
  const projectFolder = await writeConfig(config)
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)
  try {
    return getProjectRenderer(projectFolder)
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
}

Deno.test('getProjectRenderer: derives preact from compilerOptions.jsxImportSource', async () => {
  assertEquals(
    await rendererFor({
      zanix: { project: 'space' },
      compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' },
    }),
    'preact',
  )
})

Deno.test('getProjectRenderer: derives react from compilerOptions.jsxImportSource', async () => {
  assertEquals(
    await rendererFor({
      zanix: { project: 'space' },
      compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' },
    }),
    'react',
  )
})

Deno.test(
  'getProjectRenderer: an absent jsxImportSource falls back to react — matching ' +
    "defineSpaceApp({ renderer })'s own documented default",
  async () => {
    assertEquals(await rendererFor({ zanix: { project: 'space' } }), 'react')
  },
)

Deno.test('getProjectRenderer: an unreadable/absent config falls back to react', () => {
  assertEquals(getProjectRenderer('/definitely/not/a/project'), 'react')
})

Deno.test(
  'getProjectRenderer: IGNORES a stray zanix.renderer field — there is no second knob. If one is ' +
    'ever added back, this test fails and forces the conversation rather than letting two sources ' +
    'of truth coexist silently',
  async () => {
    assertEquals(
      await rendererFor({
        // Deliberately contradictory: a stray field says preact, the real projection says react.
        zanix: { project: 'space', renderer: 'preact' },
        compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' },
      }),
      'react',
    )
  },
)

Deno.test(
  {
    name:
      `baseZnxConfig: the scaffolder writes NO zanix.renderer — the renderer reaches the project config
      only as compilerOptions.jsxImportSource, the projection that actually governs what every .tsx
      file compiles to`,
    fn: () => {
      for (const renderer of ['react', 'preact'] as const) {
        const config = baseZnxConfig('space', renderer) as {
          zanix?: Record<string, unknown>
          compilerOptions?: { jsxImportSource?: string }
        }
        assertEquals(config.zanix?.renderer, undefined, renderer)
        assertEquals(config.compilerOptions?.jsxImportSource, renderer)
      }
    },
  },
)
