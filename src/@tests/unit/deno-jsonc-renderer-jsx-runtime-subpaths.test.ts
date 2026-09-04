import { assertEquals } from '@std/assert'
import { parse as parseJsonc } from '@std/jsonc'
import { fromFileUrl } from '@std/path'

/**
 * Locks in the real fix for a confirmed, reproduced-live bug: `zanix space dev`'s first real page
 * render, for EITHER renderer, failed with `Import "react/jsx-dev-runtime" not a dependency` (or
 * the `preact` equivalent) — thrown from a plain OS temp-dir file `RealImportEvaluator`
 * (`ssr-module-evaluator.ts`, `@zanix/space`) natively imports, containing Vite's own
 * SSR-dev-transform-injected `import {jsxDEV} from 'react/jsx-dev-runtime'`.
 *
 * Declaring the bare package name (`"react": "npm:react@^19.2.0"`) does NOT make its subpaths
 * resolvable through Deno's own native import-map resolution — confirmed via a real, isolated
 * `deno run --config <this file>` repro: `@deno/loader`'s own `resolveSync` auto-expands an
 * aliased bare package's subpaths, but Deno's native resolver used for a plain `import()` does
 * not. Every subpath actually reached needs its own explicit entry, same as every other subpath
 * this file already declares (`preact/hooks`, `@zanix/space/dev`, ...) for the identical reason.
 */
Deno.test(
  "deno.jsonc declares an explicit jsx-runtime/jsx-dev-runtime subpath entry for BOTH renderers' " +
    'own bare package alias',
  async () => {
    const denoJsoncPath = fromFileUrl(new URL('../../../deno.jsonc', import.meta.url))
    const config = parseJsonc(await Deno.readTextFile(denoJsoncPath)) as {
      imports?: Record<string, string>
    }
    const imports = config.imports ?? {}

    for (
      const [key, expected] of [
        ['react/jsx-runtime', 'npm:react@^19.2.0/jsx-runtime'],
        ['react/jsx-dev-runtime', 'npm:react@^19.2.0/jsx-dev-runtime'],
        ['preact/jsx-runtime', 'npm:preact@^10.29.0/jsx-runtime'],
        ['preact/jsx-dev-runtime', 'npm:preact@^10.29.0/jsx-dev-runtime'],
      ] as const
    ) {
      assertEquals(
        imports[key],
        expected,
        `deno.jsonc's own "imports" map is missing (or has the wrong value for) "${key}" — this ` +
          "regresses back to a real zanix space dev crash on that renderer's first real page " +
          "render (see this test's own module doc for the full account). Its version constraint " +
          `should stay in sync with this file's own bare '${key.split('/')[0]}' entry.`,
      )
    }
  },
)
