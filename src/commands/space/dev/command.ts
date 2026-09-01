import type { Commander } from 'cli'

import {
  registerValidationOptions,
  type SpaceValidationOptions,
} from 'commands/space/shared/validation-flags.ts'

/** Options `spaceDevAction` (`action.ts`) accepts, straight off the parsed CLI flags. */
export type SpaceDevOptions = { port?: number; graphqlCheck?: boolean } & SpaceValidationOptions

/**
 * `commands/space/dev/action.ts`'s own real path, kept as a non-literal reference — never inlined
 * into the `import(...)` call below. `commands/mod.ts` eagerly imports every command's own module
 * just to REGISTER its CLI surface (name/options/description, needed for `--help`/tab-completion
 * across the whole tool), regardless of which command a user actually runs. `action.ts`
 * transitively reaches `@zanix/server`, `@zanix/space/dev` (the real, live Vite/SSR dev bridge —
 * Vite, React, Tailwind, `sharp`, vanilla-extract, ...), and `@zanix/app/runtime` — a literal
 * specifier here would let `cli.ts`'s own necessarily-eager registration graph statically reach
 * all of that merely by resolving `space`'s CLI surface, regardless of whether `zanix space dev` is
 * ever actually run. Deno's own static dependency-graph analysis only follows a dynamic `import()`
 * whose argument it can resolve as a literal at parse time — routing it through this variable
 * keeps every OTHER `zanix` command out of that graph entirely.
 */
const SPACE_DEV_ACTION_SPECIFIER = 'commands/space/dev/action.ts'

/**
 * Narrow, hand-declared shape of `action.ts`'s own default export — deliberately NOT
 * `typeof import('commands/space/dev/action.ts')`: even a whole-module `typeof` type alias,
 * despite being erased from emitted JS, still forces the same real-source resolution (and the
 * same `@zanix/server`/`@zanix/space/dev`/`@zanix/app/runtime` reachability) as a value import.
 */
interface SpaceDevActionModule {
  default: (this: Commander, options: SpaceDevOptions) => Promise<void>
}

export function registerSpaceDevCommand(cwd: Commander): void {
  const command = cwd.command('dev')
    .description(
      'Runs a @zanix/space project in dev mode: real file-watching HMR (SSR module ' +
        'invalidation, browser-facing asset transform, automatic reload) — never a substitute ' +
        "for `zanix build`/the project's own `start` task in production.",
    )
    .option(
      '-p --port <port:number>',
      "The SSR server's port. Defaults to 20202.",
    )
    .option(
      '--no-graphql-check',
      'Skips the GraphQL query/mutation check (syntax, and schema match when a local schema ' +
        'is available). Runs by default when a gql/ directory exists; has no effect otherwise.',
    )
  registerValidationOptions(command)
  command.action(async (options: SpaceDevOptions) => {
    const { default: spaceDevAction } = await import(
      SPACE_DEV_ACTION_SPECIFIER
    ) as SpaceDevActionModule
    return spaceDevAction.call(cwd, options)
  })
}
