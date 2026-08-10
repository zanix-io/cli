import { getTemporaryFolder } from '@zanix/helpers'
import { assert } from '@std/assert'
import buildCommand from 'commands/build/main.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

type ActionCommand = { actionHandler: (options: Record<string, unknown>) => void }

function fileExists(path: string): Promise<boolean> {
  return Deno.stat(path).then(() => true).catch(() => false)
}

async function waitForFile(path: string, attemptsLeft: number): Promise<boolean> {
  if (await fileExists(path)) return true
  if (attemptsLeft <= 0) return false

  await new Promise((resolve) => setTimeout(resolve, 100))
  return waitForFile(path, attemptsLeft - 1)
}

Deno.test({
  name: 'build command action should compile the input file into the output file',
  // The action fires the real esbuild compile without awaiting it; disable sanitizers
  // since the background compile can outlive this test tick.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const cwd = new Commander()
    buildCommand.call(cwd)
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    const inputFile = `${temporaryFolder}/mod.ts`
    const outputFile = `${temporaryFolder}/out.mjs`
    await Deno.writeTextFile(inputFile, 'export const value = 1\n')
    command.actionHandler({
      inputFile,
      outputFile,
      platform: 'neutral',
      external: '@*',
    })

    assert(await waitForFile(outputFile, 50))

    await Deno.remove(temporaryFolder, { recursive: true })
  },
})
