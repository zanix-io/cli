import type { Commander } from 'cli'

import {
  registerValidationOptions,
  type SpaceValidationOptions,
} from 'commands/space/shared/validation-flags.ts'

/** Options `spaceBuildAction` (`action.ts`) accepts, straight off the parsed CLI flags. */
export interface SpaceBuildOptions extends SpaceValidationOptions {
  outDir?: string
  minify?: boolean
  obfuscate?: boolean
  messages?: boolean
  graphqlCheck?: boolean
}

/**
 * `commands/space/build/action.ts`'s own real path, kept as a non-literal reference — never
 * inlined into the `import(...)` call below. `commands/mod.ts` eagerly imports every command's
 * own module just to REGISTER its CLI surface (name/options/description, needed for `--help`/
 * tab-completion across the whole tool), regardless of which command a user actually runs.
 * `action.ts` transitively reaches `@zanix/app`, `@zanix/space`, `@zanix/space/vite` (Vite, React,
 * Tailwind, `sharp`, vanilla-extract, ...), and `javascript-obfuscator` — a literal specifier here
 * would let `cli.ts`'s own necessarily-eager registration graph statically reach all of that
 * merely by resolving `space`'s CLI surface, regardless of whether `zanix space build` is ever
 * actually run. Deno's own static dependency-graph analysis only follows a dynamic `import()`
 * whose argument it can resolve as a literal at parse time — routing it through this variable
 * keeps every OTHER `zanix` command out of that graph entirely.
 *
 * A RELATIVE specifier (`./action.ts`), not the bare import-map alias
 * `commands/space/build/action.ts` this used to be — same real, confirmed bug as
 * `commands/space/dev/command.ts`'s own identical fix: a bare alias only resolves via this file's
 * nearest `deno.jsonc` "imports" entry when loaded from a real local `file://` checkout; a
 * genuinely DYNAMIC `import()` (a variable argument, not a literal) never gets that same
 * import-map resolution once this module loads from a remote `jsr:` specifier instead —
 * `Import "commands/space/build/action.ts" not a dependency` on every real `zanix space build`
 * once installed from JSR. A relative specifier needs no import-map lookup — plain ECMAScript
 * resolution against `import.meta.url` handles both `file://` and `https://jsr.io/...` alike, and
 * still defeats static analysis the same way (routed through a variable, never an inline literal).
 */
const SPACE_BUILD_ACTION_SPECIFIER = './action.ts'

/**
 * Narrow, hand-declared shape of `action.ts`'s own default export — deliberately NOT
 * `typeof import('commands/space/build/action.ts')`: even a whole-module `typeof` type alias,
 * despite being erased from emitted JS, still forces the same real-source resolution (and the
 * same `@zanix/app`/`@zanix/space`/`@zanix/space/vite`/`javascript-obfuscator` reachability) as a
 * value import.
 */
interface SpaceBuildActionModule {
  default: (this: Commander, options: SpaceBuildOptions) => Promise<void>
}

export function registerSpaceBuildCommand(cwd: Commander): void {
  const command = cwd.command('build')
    .description(
      "Builds this @zanix/space project's real, production CLIENT bundle: comets (each its " +
        'own hashed chunk), CSS, and their manifests — never the SSR/server side, which keeps ' +
        "running directly against source (see `action.ts`'s own doc for why).",
    )
    .option(
      '--out-dir <outDir:string>',
      "Client output directory, relative to the project root. Defaults to '.dist/client'.",
    )
    .option(
      '--no-minify',
      "A flag indicating the output won't be minified. Minified by default.",
    )
    .option(
      '--obfuscate',
      'A flag to obfuscate every built .js file. Defaults to `false`.',
    )
    .option(
      '--no-messages',
      'Skips compiling defineSpaceApp({ messagesDir }) ICU catalogs to AST. Compiled by ' +
        'default when messagesDir is configured; has no effect otherwise.',
    )
    .option(
      '--no-graphql-check',
      'Skips the GraphQL query/mutation check (syntax, and schema match when a local schema ' +
        'is available). Runs by default when a gql/ directory exists; has no effect otherwise.',
    )
  registerValidationOptions(command)
  command.action(async (options: SpaceBuildOptions) => {
    const { default: spaceBuildAction } = await import(
      SPACE_BUILD_ACTION_SPECIFIER
    ) as SpaceBuildActionModule
    return spaceBuildAction.call(cwd, options)
  })
}
