/**
 * The builder compiler options. Moved here from `@zanix/utils` — verified its only real consumer
 * ecosystem-wide is `cli`'s own `zanix build` command.
 */
export type CompilerOptions =
  & Omit<import('npm:esbuild@0.20.2').BuildOptions, 'plugins'>
  & {
    /**
     * The path to the source file that will be compiled. Defaults to Zanix mod.
     */
    inputFile: string
    /**
     * The path where the compiled and obfuscated file will be saved. Defaults to Zanix dist file.
     */
    outputFile: string
    /**
     *  An optional flag to indicate if outputFile will be obfuscate. Defaults to `false`.
     */
    obfuscate?: boolean
    /**
     * A flag that determines whether a one-time worker should be used for processing.
     * Only set to true when necessary, as using workers can add overhead.
     */
    useWorker?: boolean
    /**
     * A flag indicating if outputFile will be minify. Defaults to `true`.
     */
    minify: boolean
    /**
     * A flag indicating whether bundling will be applied (i.e., grouping all files into a single output). Defaults to `true`.
     */
    bundle: boolean
    /**
     * Callback function to be executed when the process is complete.
     * It is invoked once the task or operation finishes successfully.
     */
    callback?: (response: { error?: unknown; message?: string }) => void
    /**
     * Additional Plugins
     */
    plugins?: () => import('npm:esbuild@0.20.2').Plugin[]
    /**
     * Optional builder platform. Defaults to "neutral" for Deno compatibility
     */
    platform?: 'node' | 'neutral' | 'browser'
    /**
     * NPM libraries to exclude from the bundle and mark as external.
     */
    npm?: string
  }
