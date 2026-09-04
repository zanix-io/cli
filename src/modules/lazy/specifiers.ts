/**
 * The ONE place this package's own lazily-resolved `npm:` specifiers are written down for
 * VALUE-level, RUNTIME use — `build-runner.ts`'s `mainBuilderFunction` and `obfuscate.ts`'s
 * `obfuscateFile` each resolve their own constant from here instead of inlining the string, so a
 * real version bump is a one-line change here. Matches `@zanix/core`'s/`@zanix/admin`'s identical
 * `specifiers.ts` convention.
 *
 * Both specifiers below are DELIBERATELY absent from `deno.jsonc`'s own top-level `imports` map:
 * `nodeModulesDir: "auto"`-style npm-install resolution materializes every package a `deno.json`
 * DECLARES, regardless of whether reachable code actually imports it — a bare alias declared there
 * is, on its own, enough to trigger it. `esbuild`/`javascript-obfuscator`
 * only apply to a real `zanix build` (or `zanix space build --obfuscate`) invocation — every other
 * `zanix` command must never pay for either merely by `cli.ts` registering `build`'s own CLI
 * surface (see `commands/build/main.ts`'s own lazy-load doc for the full reachability mechanism
 * this protects).
 *
 * Every `const specifier = SOME_CONSTANT` two-step at each call site (never `import(SOME_CONSTANT)`
 * inline) is deliberate, not incidental: Deno's own module graph builder only follows a dynamic
 * `import()` whose argument it can resolve as a literal at parse time — routing it through a
 * variable keeps a consumer that never triggers the matching action out of that graph entirely.
 *
 * `esbuild`'s own real version ALSO appears twice more, unavoidably, in TYPE position
 * (`plugins/npm-modules.ts`'s `import type { OnResolveArgs, Plugin } from 'npm:esbuild@0.20.2'`,
 * and `typings.ts`'s two `import('npm:esbuild@0.20.2').<X>` references) — TypeScript's own
 * `import`/`import type` specifier can never reference a variable, full stop, even within the same
 * file, so those two files can't route through `ESBUILD_SPECIFIER` the way `build-runner.ts` does.
 * See `esbuild-specifier-sync.test.ts` for the real, cheap safety net that keeps all three
 * occurrences of the version string from silently drifting apart on the next version bump.
 */

/** `esbuild`'s own real, pinned version — `build-runner.ts`'s `mainBuilderFunction` (VALUE,
 * `await import(...)`) and the two TYPE-position literals in `plugins/npm-modules.ts`/
 * `typings.ts` (which can't reference this constant — see this file's own doc). */
export const ESBUILD_SPECIFIER = 'npm:esbuild@0.20.2'

/** `javascript-obfuscator`'s own real, pinned version — `obfuscate.ts`'s `obfuscateFile` (VALUE,
 * `default` export). No type-position reference exists for this one — its own package ships no
 * `.d.ts` this package's source reads, so there's no duplicate-occurrence sync risk today. */
export const OBFUSCATOR_SPECIFIER = 'npm:javascript-obfuscator@^4.0.2'
