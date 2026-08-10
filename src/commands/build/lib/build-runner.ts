import type { CompilerOptions } from 'commands/build/lib/typings.ts'

import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader@~0.11.1'
import { defaultNpmModules, npmModulesPlugin } from 'commands/build/lib/plugins/npm-modules.ts'
import { obfuscateFile } from 'commands/build/lib/obfuscate.ts'
import logger from '@zanix/logger'

/**
 * Base function for worker
 */
export const mainBuilderFunction = async (
  {
    inputFile,
    outputFile,
    minify,
    bundle,
    obfuscate,
    npm = '',
    callback,
    onBackground,
    plugins = () => [],
    platform = 'neutral',
    external = [],
    ...options
  }: Omit<
    CompilerOptions & { onBackground?: boolean },
    'useWorker'
  >,
) => {
  const result: { error?: unknown; message?: string } = {}
  const npmExternals = npm.split(',')

  const { build, stop } = await import('npm:esbuild@0.20.2')

  try {
    // Build the file using esbuild
    await build({
      minify,
      bundle,
      plugins: [
        ...denoPlugins(),
        ...plugins(),
        npmModulesPlugin(npmExternals),
      ],
      entryPoints: [inputFile],
      outfile: outputFile,
      platform,
      external: [...defaultNpmModules, ...npmExternals, ...external],
      format: 'esm',
      ...options,
    }).finally(stop)

    // Obfuscate the built file in place — same shared helper `zanix space build` uses.
    if (obfuscate) await obfuscateFile(outputFile)

    logger.success(
      `Build and obfuscation completed ${onBackground ? 'on background' : ''}: ${outputFile}`,
    )

    result.message = 'Build completed'
    callback?.(result)

    return result
  } catch (error) {
    logger.error('Error during compile:', error, 'noSave')

    result.error = error
    callback?.(result)
  }

  return result
}
