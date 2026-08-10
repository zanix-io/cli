/**
 * Obfuscates a single file's own already-built JS content in place — the exact
 * `javascript-obfuscator` options `mainBuilderFunction` (`build-runner.ts`) already used, factored
 * out so `zanix build`'s original single-file esbuild path and `zanix space build`'s own
 * multi-file Vite client build (one real output file per comet/stylesheet, not one) can share the
 * identical obfuscation behavior instead of drifting into two independently-tuned configs.
 *
 * @param filePath - Path to an already-built `.js` file, read and overwritten in place.
 */
export async function obfuscateFile(filePath: string): Promise<void> {
  const content = await Deno.readTextFile(filePath)
  const { default: obfuscator } = await import('npm:javascript-obfuscator@^4.0.2')

  const obfuscated = obfuscator.obfuscate(content, {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    stringArray: true,
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'variable',
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode()

  await Deno.writeTextFile(filePath, obfuscated)
}
