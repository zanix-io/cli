import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import logger from '@zanix/utils/logger'
import { formatGeneratedProject, verifyGeneratedProject } from 'utils/verify.ts'

const temporaryFolder = getTemporaryFolder(import.meta.url)

async function makeProject(fileContent: string): Promise<string> {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(root, { recursive: true })
  await Deno.writeTextFile(
    `${root}/deno.json`,
    JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: true } }),
  )
  await Deno.writeTextFile(`${root}/mod.ts`, fileContent)
  return root
}

Deno.test('verifyGeneratedProject logs info when the project compiles cleanly', async () => {
  const root = await makeProject('export const value: number = 1\n')
  const infoStub = stub(logger, 'info')
  const warnStub = stub(logger, 'warn')

  try {
    await verifyGeneratedProject(root)

    assertEquals(infoStub.calls.length, 1)
    assertEquals(warnStub.calls.length, 0)
  } finally {
    infoStub.restore()
    warnStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  'verifyGeneratedProject warns (without throwing) when the project fails to compile',
  async () => {
    const root = await makeProject(
      'export const value: number = "not a number"\n',
    )
    const infoStub = stub(logger, 'info')
    const warnStub = stub(logger, 'warn')

    try {
      await verifyGeneratedProject(root)

      assertEquals(infoStub.calls.length, 0)
      assertEquals(warnStub.calls.length, 1)
      const [message] = warnStub.calls[0].args
      assert(String(message).includes('does not compile'))
    } finally {
      infoStub.restore()
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  "verifyGeneratedProject resolves the project's own deno.json, not the caller's cwd",
  async () => {
    // Regression test for a real bug found live: without an explicit `cwd`, `deno check`'s config
    // discovery resolved whatever `deno.json` happened to be above the *caller's* cwd instead of
    // the generated project's own — silently checking against the wrong `compilerOptions`/
    // `imports` entirely. This project's own `noImplicitAny: true` must be what's enforced.
    const root = await makeProject('export const untyped = (x) => x\n')
    const infoStub = stub(logger, 'info')
    const warnStub = stub(logger, 'warn')

    try {
      await verifyGeneratedProject(root)

      assertEquals(
        warnStub.calls.length,
        1,
        "implicit 'any' must be rejected by this project's own strict config",
      )
    } finally {
      infoStub.restore()
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test('verifyGeneratedProject does nothing for a project with no .ts/.tsx files', async () => {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(root, { recursive: true })
  await Deno.writeTextFile(`${root}/README.md`, '# empty project')
  const infoStub = stub(logger, 'info')
  const warnStub = stub(logger, 'warn')

  try {
    await verifyGeneratedProject(root)

    assertEquals(infoStub.calls.length, 0)
    assertEquals(warnStub.calls.length, 0)
  } finally {
    infoStub.restore()
    warnStub.restore()
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(
  "verifyGeneratedProject resolves a relative root against the caller's cwd " +
    '(regression for the double-resolved-path false failure)',
  async () => {
    // Regression test for a real bug found live via `zanix new <type> <relative-name> --verify`:
    // `getZanixPaths` builds `structure.FOLDER` relative to the calling process's cwd whenever the
    // project name itself is a plain leaf (the common case). Passing that same relative root
    // straight into `collectTsFiles` produced file paths relative to the caller's cwd; the child
    // `deno check` process (spawned with `cwd: root`) then re-resolved those already-relative
    // paths a SECOND time against ITS OWN cwd (= `root`), doubling the leaf segment (e.g.
    // `'my-app/mod.ts'` becoming `'my-app/my-app/mod.ts'`) and failing every file with a false
    // "Cannot find module" — a genuinely valid project reported as broken regardless of content.
    const parent = `${temporaryFolder}/${crypto.randomUUID()}`
    const leaf = 'relative-project'
    await Deno.mkdir(`${parent}/${leaf}`, { recursive: true })
    await Deno.writeTextFile(
      `${parent}/${leaf}/deno.json`,
      JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: true } }),
    )
    await Deno.writeTextFile(`${parent}/${leaf}/mod.ts`, 'export const value: number = 1\n')

    const originalCwd = Deno.cwd()
    const infoStub = stub(logger, 'info')
    const warnStub = stub(logger, 'warn')

    try {
      Deno.chdir(parent)
      await verifyGeneratedProject(leaf)

      assertEquals(
        warnStub.calls.length,
        0,
        'a valid project referenced by a relative root must not be reported as broken',
      )
      assertEquals(infoStub.calls.length, 1)
    } finally {
      Deno.chdir(originalCwd)
      infoStub.restore()
      warnStub.restore()
      await Deno.remove(parent, { recursive: true })
    }
  },
)

Deno.test(
  'verifyGeneratedProject still fails a relative root that has a genuine compile error ' +
    '(the relative-root fix must not weaken real failure detection)',
  async () => {
    const parent = `${temporaryFolder}/${crypto.randomUUID()}`
    const leaf = 'relative-broken-project'
    await Deno.mkdir(`${parent}/${leaf}`, { recursive: true })
    await Deno.writeTextFile(
      `${parent}/${leaf}/deno.json`,
      JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: true } }),
    )
    await Deno.writeTextFile(
      `${parent}/${leaf}/mod.ts`,
      'export const value: number = "not a number"\n',
    )

    const originalCwd = Deno.cwd()
    const infoStub = stub(logger, 'info')
    const warnStub = stub(logger, 'warn')

    try {
      Deno.chdir(parent)
      await verifyGeneratedProject(leaf)

      assertEquals(infoStub.calls.length, 0)
      assertEquals(warnStub.calls.length, 1)
      const [message] = warnStub.calls[0].args
      assert(String(message).includes('does not compile'))
      assert(
        !String(message).includes('Cannot find module'),
        'a genuine type error must be reported, not the false double-resolved-path error',
      )
    } finally {
      Deno.chdir(originalCwd)
      infoStub.restore()
      warnStub.restore()
      await Deno.remove(parent, { recursive: true })
    }
  },
)

Deno.test(
  'verifyGeneratedProject skips node_modules/.dist/.git when collecting files',
  async () => {
    const root = await makeProject('export const value: number = 1\n')
    await Deno.mkdir(`${root}/node_modules`, { recursive: true })
    // A file that would fail to compile if it were ever collected — proves it wasn't.
    await Deno.writeTextFile(
      `${root}/node_modules/broken.ts`,
      'export const x: number = "nope"\n',
    )
    const infoStub = stub(logger, 'info')
    const warnStub = stub(logger, 'warn')

    try {
      await verifyGeneratedProject(root)

      assertEquals(infoStub.calls.length, 1)
      assertEquals(warnStub.calls.length, 0)
    } finally {
      infoStub.restore()
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

// ================================================================================================
// formatGeneratedProject — unconditional (unlike --verify's own opt-in), so every test here calls
// it directly rather than through a flag. Real `deno fmt` subprocess, same as `verifyGeneratedProject`
// itself — no stubbing the formatter out.
// ================================================================================================

Deno.test(
  "formatGeneratedProject: reformats an unformatted file on disk against the project's own " +
    'fmt config — the real regression this guards against (a generated template can ship an ' +
    'unformatted defineBootstrapSpaceAppConfig(...) line)',
  async () => {
    const root = await makeProject('export const value: number = 1\n')
    // Deliberately unformatted: double quotes + semicolons, against a project fmt config that
    // wants single quotes and no semicolons (mirrors every real scaffold's own deno.json).
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ fmt: { singleQuote: true, semiColons: false } }),
    )
    await Deno.writeTextFile(
      `${root}/unformatted.ts`,
      'export const greeting = "hello";\n',
    )

    try {
      await formatGeneratedProject(root)

      const reformatted = await Deno.readTextFile(`${root}/unformatted.ts`)
      assertEquals(reformatted, "export const greeting = 'hello'\n")
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'formatGeneratedProject: never logs a warning when formatting succeeds',
  async () => {
    const root = await makeProject('export const value: number = 1\n')
    const warnStub = stub(logger, 'warn')

    try {
      await formatGeneratedProject(root)
      assertEquals(warnStub.calls.length, 0)
    } finally {
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'formatGeneratedProject: a real deno fmt failure logs a warning instead of throwing — a ' +
    'formatting-only concern must never fail the whole zanix new/generate run',
  async () => {
    const root = await makeProject('export const value: number = 1\n')
    // Genuinely unparseable syntax — `deno fmt` itself fails on this, a real (not stubbed) failure.
    await Deno.writeTextFile(`${root}/broken.ts`, 'export const x = {{{\n')
    const warnStub = stub(logger, 'warn')

    try {
      await formatGeneratedProject(root)
      assertEquals(warnStub.calls.length, 1)
    } finally {
      warnStub.restore()
      await Deno.remove(root, { recursive: true })
    }
  },
)
