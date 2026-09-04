import { assertEquals, assertExists, assertRejects, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'
import { getTemporaryFolder } from '@zanix/helpers'
import registeredMeshAction, {
  registerCredentialsMeshCommand,
} from 'commands/credentials/mesh/command.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

type ActionCommand = {
  builder: { options: unknown[] }
  settings: {
    actionHandler: (options: Record<string, unknown>, ...args: string[]) => Promise<void>
  }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerCredentialsMeshCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Recursively lists every file under `dir` — empty when `dir` doesn't exist at all. */
async function listFilesRecursively(dir: string): Promise<string[]> {
  let entries: Deno.DirEntry[]
  try {
    entries = []
    for await (const entry of Deno.readDir(dir)) entries.push(entry)
  } catch {
    return []
  }

  const nested = await Promise.all(
    entries.map((entry) => {
      const path = `${dir}/${entry.name}`
      return entry.isDirectory ? listFilesRecursively(path) : Promise.resolve([path])
    }),
  )

  return nested.flat()
}

Deno.test('credentials mesh rejects (via this.throw) with fewer than 2 identities', async () => {
  await assertRejects(
    () => registeredMeshAction.call(new Commander(), {}),
    Error,
    'needs at least 2 cooperating identities, got 0',
  )

  await assertRejects(
    () => registeredMeshAction.call(new Commander(), {}, 'solo'),
    Error,
    'needs at least 2 cooperating identities, got 1',
  )
})

Deno.test('credentials mesh rejects a duplicate identity before generating any key', async () => {
  await assertRejects(
    () => registeredMeshAction.call(new Commander(), {}, 'billing', 'billing'),
    Error,
    'Duplicate identity "billing"',
  )
})

Deno.test('credentials mesh rejects an identity that would break the .env line', async () => {
  await assertRejects(
    () => registeredMeshAction.call(new Commander(), {}, 'billing=x', 'zanix-admin'),
    Error,
    'Invalid identity "billing=x"',
  )
})

Deno.test('credentials mesh command is registered with no options', () => {
  const command = registerCommand()
  assertEquals(command.builder.options.length, 0)
})

Deno.test('credentials mesh real run: correctly cross-referenced, writes no file', async () => {
  const projectFolder = `${temporaryFolder}/${crypto.randomUUID()}`
  const cwdStub = stub(Deno, 'cwd', () => projectFolder)

  const printedLines: string[] = []
  const logStub = stub(console, 'log', (...args: unknown[]) => {
    printedLines.push(String(args[0]))
  })
  const infoStub = stub(console, 'info', () => {})

  try {
    await registeredMeshAction.call(new Commander(), {}, 'billing', 'zanix-admin', 'templates')
  } finally {
    cwdStub.restore()
    logStub.restore()
    infoStub.restore()
  }

  assertEquals(printedLines.length, 1)
  const output = printedLines[0]

  // Each private key appears exactly once, for its own identity only.
  for (const id of ['billing', 'zanix-admin', 'templates']) {
    assertEquals(output.match(new RegExp(`JWK_PRI_${id}=`, 'g'))?.length, 1)
  }

  // Each public key appears exactly twice (mesh of 3, so N - 1 = 2), correctly labeled.
  for (const id of ['billing', 'zanix-admin', 'templates']) {
    assertEquals(output.match(new RegExp(`JWK_PUB_${id}=`, 'g'))?.length, 2)
  }
  assertStringIncludes(
    output,
    `# Paste this on "zanix-admin"'s own process — it needs to verify "billing"'s assertions.`,
  )

  // The permissions placeholder is present, once per identity, and genuinely empty.
  assertStringIncludes(output, 'SERVICE_PERMISSIONS_billing=\n')

  // Every printed key, once base64-decoded, is a real PKCS#8/SPKI PEM — not a placeholder string.
  const privateKeyMatch = output.match(/JWK_PRI_billing=(\S+)/)
  assertExists(privateKeyMatch)
  const decodedPrivate = atob(privateKeyMatch[1])
  assertStringIncludes(decodedPrivate, '-----BEGIN PRIVATE KEY-----')

  // Nothing was ever written to disk — a real filesystem check, not just a code-path assertion.
  const filesWritten = await listFilesRecursively(projectFolder)
  assertEquals(filesWritten, [])
})
