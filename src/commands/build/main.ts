import { compileAndObfuscate } from 'commands/build/lib/mod.ts'
import { Commander } from 'cli'

/** 'build' command */
export default function buildCommand(this: Commander) {
  const cwd = new Commander()

  this.command('build', cwd)
    .description(
      'Compiles TypeScript code into JavaScript using esbuild for faster and optimized builds.',
    )
    .option(
      '-i --input-file <input-file:string>',
      'Specifies the fullpath to the source file that will be compiled. Defaults to root module.',
    )
    .option(
      '-o --output-file <output-file:string>',
      'Specifies the fullpath where the compiled and/or obfuscated file will be saved. Defaults to distribution file.',
    )
    .option(
      '-p --platform <platform:string>',
      'Specifies the esbuild platform. Defaults to "neutral".',
    )
    .option(
      '--external <external:string>',
      'Specifies the libraries to exclude from the bundle (e.g., library-1, library-2). By default, all scopes from jsr are excluded with @*.',
      { default: '@*' },
    )
    .option(
      '--npm <npm:string>',
      'Specifies the NPM libraries to exclude from the bundle. (e.g: npm-library-1,npm-library-2)',
    )
    .option(
      '--obfuscate',
      'A flag to indicate if outputFile will be obfuscate. Defaults to `false`',
    )
    .option(
      '-w --use-worker',
      'A flag that determines whether a worker should be used for processing. Only set to true when necessary, as using workers can add overhead.',
    )
    .option(
      '--no-minify',
      "A flag indicating if outputFile won't be minify.",
    )
    .option(
      '--no-bundle',
      "A flag indicating if bundle won't be applied (i.e., not grouping all files into a single output).",
    )
    .action((options) => {
      compileAndObfuscate({
        ...options,
        platform: options.platform as never,
        external: options.external?.split(','),
      })
    })
}
