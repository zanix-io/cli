import type { CompilerOptions } from 'commands/build/lib/typings.ts'

import { DISTRIBUTION_FILE, MAIN_MODULE } from '@zanix/utils/constants'
import { getRootDir } from '@zanix/helpers'
import { WorkerManager } from '@zanix/utils/workers'
import { mainBuilderFunction } from 'commands/build/lib/build-runner.ts'
import { join } from '@std/path'

/**
 * Compiles and obfuscates a TypeScript/JavaScript file using esbuild and javascript-obfuscator.
 * @param options - Configuration options for the build process.
 *    - `inputFile`: The full path to the source file that will be compiled. Defaults to Zanix mod.
 *    - `outputFile`: The full path where the compiled and obfuscated file will be saved. Defaults to Zanix dist file.
 *    - `obfuscate`: A flag to indicate if outputFile will be obfuscate. Defaults to `false`.
 *    - `useWorker`: A flag that determines whether a worker should be utilized for processing. Defaults to `false`.
 *    - `minify`: A flag indicating if outputFile will be minify. Defaults to `true`.
 *    - `bundle`: A flag indicating whether bundling will be applied (i.e., grouping all files into a single output). Defaults to `true`.
 *    - `callback`: Callback function to be executed when the process is complete.
 *    - `plugins`: Optional esbuild plugins functions.
 *    - `platform`: Optional esbuild platform. Defaults to `neutral`.
 *    - `npm`: NPM libraries to exclude from the bundle. (e.g: library-1,library-2)
 *    - `...`: Other general builder opts.
 *
 * This function requires the following permissions:
 * `allow-read`, `allow-env`, `allow-write`, `allow-run`
 *
 * @tags allow-read, allow-env, allow-write, allow-run
 *
 * @category helpers
 */
export function compileAndObfuscate(
  options: Partial<CompilerOptions> = {},
): void | Promise<{ error?: unknown; message?: string }> {
  const root = getRootDir()
  const {
    inputFile = join(root, MAIN_MODULE),
    outputFile = join(root, '.dist', DISTRIBUTION_FILE),
    useWorker,
    callback = () => {},
    minify = true,
    bundle = true,
    ...opts
  } = options

  if (useWorker) {
    const worker = new WorkerManager()

    return worker.task(mainBuilderFunction, {
      metaUrl: join(import.meta.url, '../build-runner.ts'),
      onFinish: ({ error, response: { message, error: runtimeError }, ..._args }) =>
        callback({ error: runtimeError || error, message, ..._args }),
      autoClose: true,
    }).invoke({ inputFile, outputFile, minify, bundle, onBackground: true, ...opts })
  } else {
    return mainBuilderFunction({ inputFile, outputFile, minify, bundle, callback, ...opts })
  }
}
