import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import logger from '@zanix/utils/logger'
import { verifyGeneratedProject } from 'utils/verify.ts'

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
    const root = await makeProject('export const value: number = "not a number"\n')
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
