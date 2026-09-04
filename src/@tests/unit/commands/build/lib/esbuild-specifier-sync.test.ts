import { assert, assertEquals } from '@std/assert'

/**
 * `esbuild`'s own real, pinned version string is written down in THREE places that can never be
 * collapsed into one: `modules/lazy/specifiers.ts`'s `ESBUILD_SPECIFIER` (the real, non-literal,
 * VALUE-level reference `build-runner.ts` resolves), and two TYPE-position literal
 * `'npm:esbuild@0.20.2'` occurrences (`plugins/npm-modules.ts`'s `import type` line,
 * `typings.ts`'s two `import('npm:esbuild@0.20.2').<X>` references) — TypeScript's own
 * `import`/`import type` specifier can never reference a variable, full stop, even within the same
 * file, so those two files can't route through the constant the way `build-runner.ts` does — a
 * mathematically unavoidable duplication. See `modules/lazy/specifiers.ts`'s own module doc for the
 * full reasoning.
 *
 * This test is the cheap, accepted safety net for that duplication: it parses each file's own raw
 * source text for the literal, rather than importing any of them (importing `typings.ts` or
 * `plugins/npm-modules.ts` would itself require resolving `npm:esbuild`, which is exactly what a
 * plain source-text parse avoids), and fails loud the moment a version bump touches one occurrence
 * without the others.
 */

const SPECIFIERS_SOURCE_URL = new URL(
  '../../../../../modules/lazy/specifiers.ts',
  import.meta.url,
)
const NPM_MODULES_SOURCE_URL = new URL(
  '../../../../../commands/build/lib/plugins/npm-modules.ts',
  import.meta.url,
)
const TYPINGS_SOURCE_URL = new URL(
  '../../../../../commands/build/lib/typings.ts',
  import.meta.url,
)

/** Every real `npm:esbuild@<version>` literal occurrence found in a file's own raw source text. */
function findEsbuildLiterals(source: string): string[] {
  return [...source.matchAll(/npm:esbuild@[\w.^~-]+/g)].map((match) => match[0])
}

Deno.test(
  'ESBUILD_SPECIFIER and every TYPE-position esbuild literal reference the same real version',
  async () => {
    const [specifiersSource, npmModulesSource, typingsSource] = await Promise.all([
      Deno.readTextFile(SPECIFIERS_SOURCE_URL),
      Deno.readTextFile(NPM_MODULES_SOURCE_URL),
      Deno.readTextFile(TYPINGS_SOURCE_URL),
    ])

    const specifierMatch = specifiersSource.match(
      /export const ESBUILD_SPECIFIER = '(npm:esbuild@[\w.^~-]+)'/,
    )
    assert(
      specifierMatch,
      "ESBUILD_SPECIFIER's own literal value could not be found — did its declaration shape change?",
    )
    const canonical = specifierMatch[1]

    const npmModulesLiterals = findEsbuildLiterals(npmModulesSource)
    const typingsLiterals = findEsbuildLiterals(typingsSource)

    assert(
      npmModulesLiterals.length > 0,
      'plugins/npm-modules.ts no longer references esbuild by a literal specifier — update this test if that import was removed or converted.',
    )
    assertEquals(
      typingsLiterals.length,
      2,
      "typings.ts's own two esbuild type-position literals changed in count — update this test to match its real shape.",
    )

    for (const literal of [...npmModulesLiterals, ...typingsLiterals]) {
      assertEquals(
        literal,
        canonical,
        `Found '${literal}', which drifted from ESBUILD_SPECIFIER's own '${canonical}' — ` +
          'a version bump must update modules/lazy/specifiers.ts, plugins/npm-modules.ts, and ' +
          'typings.ts together.',
      )
    }
  },
)
