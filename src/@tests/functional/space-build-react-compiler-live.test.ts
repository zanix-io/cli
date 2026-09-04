import { assert, assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'

/**
 * Closes the one remaining piece of the React Compiler adoption roadmap item (Space's own
 * CHANGELOG "React Compiler adoption" entry, referenced internally as P3-4): real end-to-end
 * validation that a project scaffolded via `zanix new` OUTSIDE the monorepo — resolving the real
 * published `ZANIX_DEPENDENCY_VERSIONS['@zanix/space']`, never a local link/path override —
 * actually builds through the React Compiler pipeline via `zanix space build`
 * (`renderer: 'react'`, the default). This was blocked until `@zanix/space`/`@zanix/space-ui`
 * were genuinely published on JSR; now that they are, this is a real, permanent, repeatable test
 * — not the disposable Playwright spike Fast Refresh/HMR was verified with separately (that spike
 * stays exactly that: a one-time architectural check, never promoted into this or any other
 * package's permanent suite).
 *
 * Two real subprocesses, no mocks: `deno run new space <project>` (this repo's own `new` task,
 * the same shorthand every other `commands.new.test.ts` case uses — resolves via `cwd`, this
 * file's process default, the `cli` repo root), then `zanix space build` invoked directly against
 * `cli`'s own `mod.ts` by absolute path (the `new`/`generate` shorthand has no equivalent task for
 * `space build`, and `spaceBuildAction` reads `Deno.cwd()` directly rather than taking an explicit
 * root argument — see its own doc — so the subprocess itself must run `cwd`'d into the scaffolded
 * project).
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

const CLI_MOD = join(dirname(fromFileUrl(import.meta.url)), '../../../mod.ts')

// Real hook usage (`useState`), a derived value computed with no manual `useMemo`, an inline
// event handler, and a top-level `<>...</>` Fragment — the exact shape `@zanix/space`'s own
// `react-compiler.test.ts` (P3-4's pre-adoption spike) uses as compiler-detection evidence.
// Written over the scaffold's trivial placeholder comet (`<div>ExampleCounter</div>`, nothing for
// a compiler to memoize) so this build has something real to compile.
//
// `defineComet` imported from `@zanix/space/comet`, never the root `@zanix/space` — confirmed
// live (2026-08-30) as a real, reproducible ~2min+ hang otherwise, not just noise: the root
// barrel deliberately doesn't re-export `defineComet` (see `cometTemplate`'s own doc,
// `commands/generate/comet/template.ts`) precisely because resolving it pulls server/dev-only
// code into the CLIENT bundle's own dependency graph — here, that meant Rolldown walking into
// `sharp`/`vite-node`/`@vanilla-extract/integration`/`@deno/loader`/`rolldown` itself. Isolated by
// direct bisection (fresh scaffolds, `sample`-based stack inspection showing 100% of the hang
// inside `rolldown-binding`'s own native code): swapping only this import to `@zanix/space/comet`
// took the exact same build from a multi-minute hang to 728ms, with the full hook/filter/Fragment/
// inline-handler shape below unchanged.
const REACT_COMET_SOURCE = `'use comet'

import { useState } from 'react'
import { defineComet } from '@zanix/space/comet'

export function ExampleCounter({ items }: { items: string[] }) {
  const [count, setCount] = useState(0)
  const visible = items.filter((item) => item.length > count)
  return (
    <>
      <p data-testid="count">{count}</p>
      <ul>{visible.map((item) => <li key={item}>{item}</li>)}</ul>
      <button type="button" onClick={() => setCount((c) => c + 1)}>increment</button>
    </>
  )
}

export default defineComet(ExampleCounter, import.meta.url)
`

Deno.test(
  "zanix new space (default renderer 'react') scaffolds a project resolving the real published " +
    '@zanix/space from JSR (no local link/path override anywhere), and `zanix space build` ' +
    'genuinely compiles it through React Compiler — the built comet chunk carries React ' +
    "Compiler's own `useMemoCache` runtime helper and a real per-component memo-cache-array " +
    "pattern, the same evidence `@zanix/space`'s own react-compiler.test.ts uses",
  async () => {
    // A random OUTER container (never itself passed as a project name), with a fixed, valid
    // literal leaf name for the actual scaffolded project — same convention every other
    // `Deno.makeTempDir`-based functional test here uses (`commands.new.test.ts`,
    // `space-welcome-live.test.ts`). A raw `crypto.randomUUID()` as the project's own basename
    // would fail probabilistically: `zanix space build` derives `space.app.ts`'s `name` field
    // from it (`toKebabCase(projectName)`), and `@zanix/app`'s own name validation requires
    // starting with a lowercase letter — a UUID starts with a hex DIGIT (not `a`-`f`) 10 times out
    // of 16, so this would fail ~62% of runs.
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const project = join(root, 'space-build-react-compiler-project')

    try {
      const newResult = await new Deno.Command('deno', {
        args: ['run', 'new', 'space', project],
      }).output()
      assert(
        newResult.success,
        `zanix new space failed: ${new TextDecoder().decode(newResult.stderr)}`,
      )

      const configText = await Deno.readTextFile(join(project, 'deno.json'))
      const config = JSON.parse(configText)
      assertEquals(
        config.imports['@zanix/space'],
        ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
        `deno.json must resolve @zanix/space from the real JSR registry, got:\n${configText}`,
      )
      assert(
        !('links' in config) || (Array.isArray(config.links) && config.links.length === 0),
        `a freshly scaffolded project must declare no local link override, got:\n${configText}`,
      )
      assert(
        !configText.includes('file:') && !configText.includes('../space'),
        `deno.json must contain no local file:/relative-path override for @zanix/space, got:\n${configText}`,
      )

      const cometPath = join(project, 'src/space/comets/example.comet.tsx')
      await Deno.writeTextFile(cometPath, REACT_COMET_SOURCE)

      const buildResult = await new Deno.Command('deno', {
        args: ['run', '-A', CLI_MOD, 'space', 'build'],
        cwd: project,
      }).output()
      assert(
        buildResult.success,
        `zanix space build failed:\n${new TextDecoder().decode(buildResult.stderr)}`,
      )

      const assetsDir = join(project, '.dist/client/assets')
      const jsFiles: string[] = []
      for await (const entry of Deno.readDir(assetsDir)) {
        if (entry.isFile && entry.name.endsWith('.js')) jsFiles.push(entry.name)
      }
      // `toEntryName` (`build-client.ts`) derives the chunk name from the comet's own path
      // relative to the project root, sanitized — never just its basename — so this project's
      // `src/space/comets/example.comet.tsx` becomes `src-space-comets-example_comet-*.js`, not
      // `example-*.js`.
      const cometChunk = jsFiles.find((f) => f.startsWith('src-space-comets-example_comet'))
      assert(
        cometChunk,
        `expected an src-space-comets-example_comet-* comet chunk, got: ${jsFiles.join(', ')}`,
      )

      const code = await Deno.readTextFile(join(assetsDir, cometChunk))
      // React Compiler's own runtime memoization helper — never present in an uncompiled build.
      assert(
        code.includes('useMemoCache'),
        `expected React Compiler's runtime helper in the real published-package build, got:\n${code}`,
      )
      // The generated cache-slot pattern React Compiler's own output always uses — confirms a real
      // per-component memoization cache was generated, not just that the helper is reachable.
      assert(/\[0\]\s*!==/.test(code), `expected a real memo-cache-array read, got:\n${code}`)
      // Static content survived the compile untouched.
      assert(code.includes('data-testid'), code)
      assert(code.includes('increment'), code)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
