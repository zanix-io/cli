import { getTemporaryFolder } from '@zanix/helpers'
import { assert, assertRejects } from '@std/assert'
import buildCommand from 'commands/build/main.ts'
import { Commander } from 'cli'

const temporaryFolder = getTemporaryFolder(import.meta.url)

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => Promise<void> }
}

function fileExists(path: string): Promise<boolean> {
  return Deno.stat(path).then(() => true).catch(() => false)
}

Deno.test({
  name: 'build command action compiles the input file into the output file',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const cwd = new Commander()
    buildCommand.call(cwd)
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    const inputFile = `${temporaryFolder}/mod.ts`
    const outputFile = `${temporaryFolder}/out.mjs`
    await Deno.writeTextFile(inputFile, 'export const value = 1\n')

    // The action now genuinely awaits the compile (previously fire-and-forget — see this
    // command's own comment on why) — no more polling needed, the file exists the moment this
    // resolves.
    await command.settings.actionHandler({
      inputFile,
      outputFile,
      platform: 'neutral',
      external: '@*',
    })

    assert(await fileExists(outputFile))

    await Deno.remove(temporaryFolder, { recursive: true })
  },
})

Deno.test({
  name: 'build command action rejects (does not silently resolve) when the compile actually fails',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Locks in the fix: previously the action never awaited/checked the compile result at all,
    // so a real esbuild failure (a nonexistent input file, here) still let the command exit 0 —
    // a CI pipeline gating on `znx build`'s exit code would pass silently on a broken build.
    const cwd = new Commander()
    buildCommand.call(cwd)
    const command = cwd.getCommands()[0] as unknown as ActionCommand

    await assertRejects(
      () =>
        command.settings.actionHandler({
          inputFile: `${temporaryFolder}/does-not-exist.ts`,
          outputFile: `${temporaryFolder}/unused-out.mjs`,
          platform: 'neutral',
          external: '@*',
        }),
    )
  },
})
