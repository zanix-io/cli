import { assert } from '@std/assert'
import { resolve } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildIntraRepoGraph } from 'commands/check-cycles/lib/graph.ts'

// Locks in the real fix at `graph.ts`'s `runDenoInfo`: the spawned `deno info --json` subprocess
// must run with `cwd: root` (the CHECKED repo's own root), not the calling process's own cwd —
// `deno info` resolves an entrypoint's own import-map/path-alias entries (a `deno.json(c)`
// "imports" entry, e.g. `"modules/": "./src/modules/"`) relative to ITS OWN process cwd, not
// relative to the entrypoint file's location. Confirmed real, not hypothetical: `@zanix/utils`'s
// own `logger/mod.ts` re-exports from `modules/logger/main.ts` via exactly this kind of alias —
// without an explicit `cwd: root`, that import silently fails to resolve (no error, just an
// incomplete graph missing the edge), which made a real, confirmed cycle in `@zanix/utils`
// invisible to this same tool.
//
// This fixture reconstructs that same alias shape as a real, self-contained mini-repo (its own
// `deno.json` + a bare/aliased import), run with a real `deno info` subprocess — not mocked, since
// the bug is specifically about how `Deno.Command`'s own `cwd` option is passed, something a mock
// of `deno info`'s output could never catch.

const fixtureRoot = resolve(getTemporaryFolder(import.meta.url), 'alias-import-fixture')
const entrypoint = resolve(fixtureRoot, 'src/mod.ts')
const aliasedModule = resolve(fixtureRoot, 'src/modules/helper.ts')

async function writeFixture(): Promise<void> {
  await Deno.mkdir(resolve(fixtureRoot, 'src/modules'), { recursive: true })

  await Deno.writeTextFile(
    resolve(fixtureRoot, 'deno.json'),
    JSON.stringify({
      imports: { 'modules/': './src/modules/' },
      exports: './src/mod.ts',
    }),
  )

  await Deno.writeTextFile(
    entrypoint,
    `export { helper } from 'modules/helper.ts'\n`,
  )

  await Deno.writeTextFile(
    aliasedModule,
    `export const helper = (): string => 'ok'\n`,
  )
}

Deno.test(
  'buildIntraRepoGraph resolves an alias-style import (deno info run with cwd: root)',
  async () => {
    await writeFixture()

    try {
      const { graph, specifierResolutions } = await buildIntraRepoGraph(fixtureRoot, [entrypoint])

      const deps = graph.get(entrypoint)
      assert(deps, `expected '${entrypoint}' to appear in the graph as its own node`)
      assert(
        deps.has(aliasedModule),
        `expected the alias import 'modules/helper.ts' to resolve to '${aliasedModule}' — the ` +
          `real, confirmed bug shape (missing 'cwd: root') produces an incomplete graph with this ` +
          `edge silently missing instead of an error. Got edges: [${[...deps].join(', ')}]`,
      )

      const resolutions = specifierResolutions.get(entrypoint)
      assert(resolutions, `expected specifier resolutions to be recorded for '${entrypoint}'`)
      assert(
        resolutions.get('modules/helper.ts') === aliasedModule,
        `expected the raw specifier 'modules/helper.ts' to resolve to '${aliasedModule}'`,
      )
    } finally {
      await Deno.remove(fixtureRoot, { recursive: true })
    }
  },
)
