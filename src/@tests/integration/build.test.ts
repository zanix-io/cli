import { assert, assertEquals } from '@std/assert'
import { compileAndObfuscate } from 'commands/build/lib/mod.ts'
import { obfuscateFile } from 'commands/build/lib/obfuscate.ts'
import { getTemporaryFolder } from '@zanix/helpers'
import { stub } from '@std/testing/mock'

// Disable logs by testing
stub(console, 'error')
stub(console, 'info')

const temporaryFile = getTemporaryFolder(import.meta.url)
const outputFile = temporaryFile + '/dist.js'
const inputFile = temporaryFile + '/input.js'
const inputContent = `const myConsole = ()=>{
  console.log('test')
}
myConsole();`

Deno.test('compileAndObfuscate should generate a bundled an minified output file', async () => {
  await Deno.writeTextFile(inputFile, inputContent)
  const response = await compileAndObfuscate({ outputFile, inputFile })
  assertEquals(response?.message, 'Build completed')
  assertEquals(response['_wasWorkerThread' as never], undefined)
  const distContent = await Deno.readTextFile(outputFile)
  assert(distContent !== inputContent)
  assert(distContent.includes('()=>{console.log("test")};'))
  assert(!distContent.includes('myConsole();'))

  await Deno.remove(inputFile)
  await Deno.remove(outputFile)
})

Deno.test('compileAndObfuscate should generate non minified output file', async () => {
  await Deno.writeTextFile(inputFile, inputContent)
  await compileAndObfuscate({ outputFile, inputFile, minify: false })

  const distContent = await Deno.readTextFile(outputFile)
  assert(distContent.includes('myConsole();'))

  await Deno.remove(inputFile)
  await Deno.remove(outputFile)
})

Deno.test('compileAndObfuscate should obfuscate the output file', async () => {
  await Deno.writeTextFile(inputFile, inputContent)
  await compileAndObfuscate({ outputFile, inputFile, obfuscate: true })

  const distContent = await Deno.readTextFile(outputFile)
  assert(distContent !== inputContent)
  assert(!distContent.includes('()=>{console.log("test")};'))

  await Deno.remove(inputFile)
  await Deno.remove(outputFile)
})

Deno.test(
  'obfuscateFile is deterministic for identical input — same source obfuscated twice ' +
    'produces byte-identical output, so a rebuild of unchanged content never mints a new ' +
    "content hash under `zanix space build`'s own Vite/Rollup plugin (createObfuscationPlugin), " +
    "which computes each chunk's hash straight from this same obfuscated output",
  async () => {
    // Large enough (~200KB) to reproduce, as a real regression test, a genuine bug found while
    // building this: seeding `javascript-obfuscator` with the FULL pre-obfuscation code (instead
    // of a short hash of it) made a single `obfuscate()` call on a realistic chunk this size never
    // finish within 30+ seconds — confirmed empirically, not a guess. `race` below fails fast and
    // loud instead of hanging the whole test run if that regresses.
    const largeContent = `"${'x'.repeat(200_000)}";\nfunction marker() { return 'first-run' }\n`
    const secondPath = temporaryFile + '/dist-second.js'

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`obfuscateFile took longer than ${ms}ms`)), ms)
        ),
      ])

    try {
      await Deno.writeTextFile(outputFile, largeContent)
      await withTimeout(obfuscateFile(outputFile), 10_000)
      const firstRun = await Deno.readTextFile(outputFile)

      // A SEPARATE file, same pre-obfuscation content — independent of the first run, the same
      // way two real, separate `zanix space build` invocations would be.
      await Deno.writeTextFile(secondPath, largeContent)
      await withTimeout(obfuscateFile(secondPath), 10_000)
      const secondRun = await Deno.readTextFile(secondPath)

      assertEquals(secondRun, firstRun)
    } finally {
      await Deno.remove(outputFile).catch(() => {})
      await Deno.remove(secondPath).catch(() => {})
    }
  },
)

Deno.test(
  'compileAndObfuscate should generate a bundled an minified output file using a worker by default',
  async () => {
    await Deno.writeTextFile(inputFile, inputContent)
    const compileResponse: {
      message?: string
      error?: unknown
      _wasWorkerThread?: boolean
    } = await new Promise((resolve) =>
      compileAndObfuscate({
        outputFile,
        inputFile,
        useWorker: true,
        callback: resolve,
      })
    )

    assertEquals(compileResponse.message, 'Build completed')
    assertEquals(compileResponse._wasWorkerThread, true)
    const distContent = await Deno.readTextFile(outputFile)
    assert(distContent.includes('()=>{console.log("test")};'))

    await Deno.remove(inputFile)
    await Deno.remove(outputFile)
  },
)
