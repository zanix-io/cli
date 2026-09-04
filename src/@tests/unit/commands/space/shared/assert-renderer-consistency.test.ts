import { getTemporaryFolder } from '@zanix/helpers'
import { assertEquals, assertThrows } from '@std/assert'
import { Commander } from 'cli'
import { assertRendererConsistency } from 'commands/space/shared/assert-renderer-consistency.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

// ================================================================================================
// ONE renderer choice, two projections, and no way to diverge in silence.
//
// `defineSpaceApp({ renderer })` is the single place a project selects its renderer.
// `compilerOptions.jsxImportSource` is that same choice projected onto the compiler, because Deno
// cannot read the app manifest and a JSR-published runtime cannot reliably read deno.json. Neither
// projection can be removed, so the guarantee has to come from asserting they agree.
// ================================================================================================

async function withConfig<T>(
  config: unknown,
  run: (root: string) => T,
): Promise<T> {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(root, { recursive: true })
  if (config !== undefined) {
    await Deno.writeTextFile(`${root}/deno.jsonc`, JSON.stringify(config))
  }
  try {
    return run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test('assertRendererConsistency: agreeing projections pass, both directions', async () => {
  for await (const renderer of ['react', 'preact'] as const) {
    await withConfig(
      { zanix: { project: 'space' }, compilerOptions: { jsxImportSource: renderer } },
      (root) => assertRendererConsistency(new Commander(), root, renderer),
    )
  }
})

Deno.test(
  'assertRendererConsistency: a mismatch fails loudly, naming BOTH sides and how to fix it — the ' +
    'symptom otherwise is blank output or a serializer error that points nowhere near the cause',
  async () => {
    await withConfig(
      { zanix: { project: 'space' }, compilerOptions: { jsxImportSource: 'react' } },
      (root) => {
        const error = assertThrows(
          () => assertRendererConsistency(new Commander(), root, 'preact'),
          Error,
        )
        assertEquals(error.message.includes("renderer: 'preact'"), true)
        assertEquals(error.message.includes("jsxImportSource: 'react'"), true)
        assertEquals(error.message.includes('two projections of ONE choice'), true)
      },
    )
  },
)

Deno.test('assertRendererConsistency: the opposite mismatch fails too', async () => {
  await withConfig(
    { zanix: { project: 'space' }, compilerOptions: { jsxImportSource: 'preact' } },
    (root) => {
      assertThrows(() => assertRendererConsistency(new Commander(), root, 'react'), Error)
    },
  )
})

Deno.test(
  'assertRendererConsistency: an ABSENT jsxImportSource is not a mismatch — a project that never ' +
    'set it is claiming nothing to disagree with, and Deno reports it far more clearly on the ' +
    'first JSX file it transpiles',
  async () => {
    await withConfig(
      { zanix: { project: 'space' } },
      (root) => assertRendererConsistency(new Commander(), root, 'preact'),
    )
  },
)

Deno.test(
  "assertRendererConsistency: an absent config is not this guard's problem — every other part of " +
    'the command reports it more clearly',
  () => {
    assertRendererConsistency(new Commander(), '/definitely/not/a/project', 'preact')
  },
)
