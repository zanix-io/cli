import { Commander } from 'cli'

/**
 * `commands/build/lib/mod.ts`'s own real path, kept as a non-literal reference — never inlined
 * into the `import(...)` call below. `commands/mod.ts` eagerly imports every command's own module
 * (this one included) just to REGISTER its CLI surface (name/options/description, needed for
 * `--help`/tab-completion across the whole tool), regardless of which command a user actually
 * runs. `commands/build/lib/mod.ts` transitively reaches `esbuild`/`javascript-obfuscator`
 * (`build-runner.ts`/`obfuscate.ts`) — a literal specifier here would let `cli.ts`'s own
 * necessarily-eager registration graph statically reach both npm packages merely by resolving
 * `build`'s CLI surface, regardless of whether `zanix build` is ever actually run. Deno's own
 * static dependency-graph analysis only follows a dynamic `import()` whose argument it can resolve
 * as a literal at parse time — routing it through this variable keeps every OTHER `zanix` command
 * out of that graph entirely.
 *
 * A RELATIVE specifier (`./lib/mod.ts`), never the bare import-map alias `commands/build/lib/mod.ts`:
 * a bare alias resolves via `command.ts`'s own nearest `deno.jsonc` "imports" entry when this
 * module loads from a real local `file://` checkout, but a genuinely
 * DYNAMIC `import()` (a variable argument, not a literal Deno's static analyzer could trace) never
 * gets that same import-map resolution once this module itself loads from a remote `jsr:`
 * specifier instead — `Import "commands/build/lib/mod.ts" not a dependency` on every real `zanix
 * build` invocation once installed from JSR. A relative specifier needs no import-map lookup at
 * all — it resolves directly against `import.meta.url` (`file://` or `https://jsr.io/...`, either
 * way) via plain ECMAScript module resolution, and still defeats static analysis the identical way
 * a bare one did (routed through a variable, never an inline literal).
 */
const BUILD_LIB_MODULE_SPECIFIER = './lib/mod.ts'

/**
 * Narrow, hand-declared shape of `commands/build/lib/mod.ts`'s own real exports — deliberately NOT
 * `typeof import('commands/build/lib/mod.ts')`: even a whole-module `typeof` type alias, despite
 * being erased from emitted JS, still forces the same real-source resolution (and the same
 * `esbuild`/`javascript-obfuscator` reachability) as a value import. Only the one function this
 * action actually calls, typed loosely enough (`Record<string, unknown>`) to avoid needing
 * `CompilerOptions` itself — `typings.ts`'s own type additionally carries `esbuild`'s TYPE-position
 * literal, which would reintroduce the exact leak this file exists to avoid.
 */
interface BuildLibModule {
  compileAndObfuscate: (
    options: Record<string, unknown>,
  ) => Promise<{ error?: unknown; message?: string }>
}

/** 'build' command */
export default function buildCommand(this: Commander) {
  const cwd = new Commander()

  this.mountGroup('build', cwd)
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
    .action(async (options) => {
      // Must await/check the result, not fire-and-forget it: a CI pipeline gating on `znx build`'s
      // exit code needs a real compile failure (esbuild error, obfuscation error) to actually exit
      // non-zero, not pass silently on a broken build. `compileAndObfuscate` never rejects on its
      // own (see its own doc) — it resolves with `{ error }` — so this has to explicitly check for
      // that and hand it to Cliffy's own `this.throw`, the single place this whole CLI turns a
      // failure into a non-zero exit code (see `cli.ts`'s own handler).
      const { compileAndObfuscate } = await import(BUILD_LIB_MODULE_SPECIFIER) as BuildLibModule
      const { error } = await compileAndObfuscate({
        ...options,
        platform: options.platform as never,
        external: options.external?.split(','),
      })
      if (error) cwd.throw(error instanceof Error ? error : new Error(String(error)))
    })
}
