import { assert, assertEquals, assertMatch } from '@std/assert'
import { walk } from '@std/fs'
import { fromFileUrl, relative } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'

/**
 * Verifies that all three lazy-command-module specifiers
 * (`BUILD_LIB_MODULE_SPECIFIER`/`SPACE_DEV_ACTION_SPECIFIER`/`SPACE_BUILD_ACTION_SPECIFIER`) stay
 * RELATIVE (`./action.ts`, `./lib/mod.ts`), never a bare, project-import-map-aliased one (e.g.
 * `'commands/space/dev/action.ts'`). Each lives in a variable, not an inline literal, specifically
 * so Deno's own static dependency-graph analysis (which only follows a dynamic `import()` whose
 * argument it can resolve as a literal at parse time) never eagerly pulls that command's own heavy
 * transitive dependencies into every OTHER `zanix` invocation — see each `command.ts`'s own doc
 * for the full reasoning.
 *
 * A bare alias only resolves via the nearest `deno.jsonc` "imports" entry when the importing
 * module itself loads from a real local `file://` checkout. Once installed globally from JSR
 * (`deno install -g jsr:@zanix/cli`), the module loads from a remote `https://jsr.io/...`
 * specifier instead, and a genuinely DYNAMIC `import()` of a bare alias never gets that same
 * import-map resolution — it throws `Import "..." not a dependency` on every real invocation of
 * the affected command. A relative specifier needs no import-map lookup at all: plain ECMAScript
 * module resolution against `import.meta.url` works identically whether that URL is `file://` or
 * `https://jsr.io/...`, while still defeating static analysis the same way a bare one does (routed
 * through a variable, never an inline literal).
 *
 * This test parses each file's own raw source text (never imports them — importing
 * `command.ts`/`main.ts` would itself trigger the very command registration this pattern exists to
 * avoid paying for) and fails loud if any of the three regresses back to a bare, non-relative
 * specifier.
 *
 * The same shape recurs one level DEEPER, inside `action.ts` itself, not just the `command.ts`
 * boundary that reaches it: `space/build/action.ts`'s own `compile-messages.ts` imports
 * (`compileMessagesTree`/`assertNoCompileFailures`, and separately `writeCompiledCatalogs`) and
 * `graphql-check.ts` import, plus `space/dev/action.ts`'s own `graphql-check.ts` import, are each a
 * bare literal `import('commands/space/shared/...')` with no named constant to enumerate
 * case-by-case like `CASES` above. The sweep below generalizes instead of adding a
 * fourth/fifth/sixth/seventh named case: it reads `deno.jsonc`'s own real "imports" map, keeps only
 * the LOCAL aliases (values starting with `./` — a bare specifier resolving to a jsr:/npm: package
 * is fine either way, only a project-local relative-path alias depends on the nearest `deno.jsonc`
 * being in scope), then scans every real (non-test) source file under `src/commands` for a dynamic
 * `import(...)` whose literal argument starts with one of those aliases — comments stripped first,
 * so a JSDoc line merely naming a module this way (as several already do) never false-positives.
 * There is no legitimate reason for that shape to exist in this codebase, so this also catches any
 * future instance of the same mistake.
 */

const CASES = [
  {
    file: new URL('../../../commands/build/main.ts', import.meta.url),
    constant: 'BUILD_LIB_MODULE_SPECIFIER',
  },
  {
    file: new URL('../../../commands/space/dev/command.ts', import.meta.url),
    constant: 'SPACE_DEV_ACTION_SPECIFIER',
  },
  {
    file: new URL('../../../commands/space/build/command.ts', import.meta.url),
    constant: 'SPACE_BUILD_ACTION_SPECIFIER',
  },
] as const

for (const { file, constant } of CASES) {
  Deno.test(
    `${constant} is a relative specifier, not a bare project-alias one`,
    async () => {
      const source = await Deno.readTextFile(file)
      const match = source.match(new RegExp(`const ${constant} = '([^']+)'`))
      assert(
        match,
        `${constant}'s own literal value could not be found in ${file} — did its declaration ` +
          'shape change? Update this test to match.',
      )

      const value = match[1]
      assertMatch(
        value,
        /^\.\//,
        `${constant} = '${value}' is not a relative specifier (doesn't start with './') — this ` +
          'is exactly the shape that breaks once @zanix/cli is loaded from a remote jsr: ' +
          "specifier instead of a local file:// checkout (see this test file's own module doc).",
      )
    },
  )
}

/**
 * Strips block (`/* *\/`) and line (`//`) comments before the sweep below scans for a bare-alias
 * specifier — otherwise a JSDoc line merely NAMING a module by its alias-form path (e.g. this very
 * file's own `${constant}` cases, referenced in surrounding doc comments as
 * `` `typeof import('commands/space/build/action.ts')` `` ) would false-positive as if it were a
 * real, live dynamic import. The line-comment pass uses a negative lookbehind for a preceding `:`
 * so it never eats the `//` inside a `https://...` string literal.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/.*$/gm, '')
}

Deno.test(
  'no dynamic import() anywhere under src/commands uses a bare local-alias specifier',
  async () => {
    // Generalizes the three named CASES above to every OTHER dynamic import in the tree, so a
    // future instance of the exact same mistake (a literal `import('commands/...')`, not routed
    // through a named, individually-tested constant — see this file's own module doc for the two
    // real ones found this way, in `space/build/action.ts` and `space/dev/action.ts`) fails loud
    // here instead of shipping unnoticed. Only LOCAL aliases (`deno.jsonc` "imports" values
    // starting with `./`) are the vulnerable shape — a bare specifier resolving to a jsr:/npm:
    // package resolves identically everywhere Deno can reach the registry, import-map or not; only
    // a project-local relative-path alias depends on the nearest `deno.jsonc` actually being in
    // scope, which `deno install -g`'s own synthetic shim config never provides (see the module
    // doc above for the full mechanism).
    const denoJsoncPath = fromFileUrl(new URL('../../../../deno.jsonc', import.meta.url))
    const config = parseJsonc(await Deno.readTextFile(denoJsoncPath)) as {
      imports?: Record<string, string>
    }
    const localAliasKeys = Object.entries(config.imports ?? {})
      .filter(([, value]) => value.startsWith('./'))
      .map(([key]) => key)
    assert(
      localAliasKeys.length > 0,
      'expected at least one local alias in deno.jsonc\'s own "imports" map — did it move or get ' +
        're-shaped? Update this test to match.',
    )

    const commandsDir = fromFileUrl(new URL('../../../commands', import.meta.url))
    const offenders: string[] = []
    for await (
      const entry of walk(commandsDir, {
        exts: ['.ts', '.tsx'],
        skip: [/[\\/]@tests[\\/]/],
      })
    ) {
      if (!entry.isFile) continue
      const source = stripComments(await Deno.readTextFile(entry.path))
      for (const match of source.matchAll(/\bimport\(\s*(['"])([^'"]+)\1/g)) {
        const specifier = match[2]
        if (localAliasKeys.some((key) => specifier === key || specifier.startsWith(key))) {
          offenders.push(`${relative(commandsDir, entry.path)}: import('${specifier}')`)
        }
      }
    }

    assertEquals(
      offenders,
      [],
      'Found a bare local-alias specifier passed directly to a dynamic import() — this only ' +
        'resolves when the importing module itself loaded from a real local file:// checkout. ' +
        "`deno install -g`'s own generated shim config carries no import map at all, so once " +
        '@zanix/cli loads from a remote jsr: specifier (any real global install), the same ' +
        'specifier throws `Import "..." not a dependency` — see this file\'s own module doc for ' +
        'the full account. Use a relative specifier instead.',
    )
  },
)
