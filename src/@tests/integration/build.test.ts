import { assert, assertEquals } from '@std/assert'
import { compileAndObfuscate } from 'commands/build/lib/mod.ts'
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
  'compileAndObfuscate should generate a bundled an minified output file using a worker by default',
  async () => {
    await Deno.writeTextFile(inputFile, inputContent)
    const compileResponse: { message?: string; error?: unknown; _wasWorkerThread?: boolean } =
      await new Promise((resolve) =>
        compileAndObfuscate({ outputFile, inputFile, useWorker: true, callback: resolve })
      )

    assertEquals(compileResponse.message, 'Build completed')
    assertEquals(compileResponse._wasWorkerThread, true)
    const distContent = await Deno.readTextFile(outputFile)
    assert(distContent.includes('()=>{console.log("test")};'))

    await Deno.remove(inputFile)
    await Deno.remove(outputFile)
  },
)
