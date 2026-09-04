import { assertEquals } from '@std/assert'
import { resolve } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { findConfirmedFindings } from 'commands/check-cycles/lib/analyze.ts'
import type { Cycle } from 'commands/check-cycles/lib/cycles.ts'
import type { SpecifierResolutions } from 'commands/check-cycles/lib/graph.ts'

// Locks in the real fix: `runHarness` (`analyze.ts`) used to resolve its own harness script path
// (`fromFileUrl(import.meta.url)`) at MODULE TOP LEVEL — which only works when the module itself
// loaded from a real `file://` URL (running `zanix` from a local checkout). Once installed
// globally from JSR (`deno install -g jsr:@zanix/cli`), this module loads from an `https://
// jsr.io/...` specifier instead, and that top-level call threw `TypeError: Must be a file URL`
// on EVERY `zanix` invocation, not just `check-cycles` — confirmed real, reproduced live against
// a real `deno install -g jsr:@zanix/cli@2.0.0`, where even `zanix --version` crashed. Moved the
// path resolution into `runHarness` itself so it's computed lazily, only when this command
// actually runs — this test proves the harness subprocess this function spawns still resolves
// and runs correctly with that lazy path, not just that the module now merely imports without
// throwing (a real subprocess invocation, not a mock, since a mock couldn't have caught the
// original bug either).

const fixtureRoot = resolve(getTemporaryFolder(import.meta.url), 'analyze-harness-fixture')
const derivedPath = resolve(fixtureRoot, 'derived.ts')
const basePath = resolve(fixtureRoot, 'base.ts')

async function writeFixture(): Promise<void> {
  await Deno.mkdir(fixtureRoot, { recursive: true })
  await Deno.writeTextFile(
    derivedPath,
    `import { Base } from './base.ts'\n\nexport class Derived extends Base {}\n`,
  )
  await Deno.writeTextFile(basePath, `export class Base {}\n`)
}

Deno.test(
  'findConfirmedFindings: runHarness spawns its subprocess and resolves a real finding (lazy harness path)',
  async () => {
    await writeFixture()

    try {
      // Hand-built, not derived from a real `buildIntraRepoGraph` call — `findConfirmedFindings`
      // only ever cross-references what it's given, so asserting cycle membership directly here
      // keeps this test scoped to `runHarness`'s own subprocess behavior, not `graph.ts`'s
      // (already covered by this same directory's own `graph.test.ts`).
      const cycles: Cycle[] = [[derivedPath, basePath]]
      const specifierResolutions: SpecifierResolutions = new Map([
        [derivedPath, new Map([['./base.ts', basePath]])],
        [basePath, new Map()],
      ])

      const findings = await findConfirmedFindings(cycles, specifierResolutions)

      assertEquals(findings.length, 1)
      assertEquals(findings[0].file, derivedPath)
      assertEquals(findings[0].identifier, 'Base')
      assertEquals(findings[0].sourceFile, basePath)
      assertEquals(findings[0].line, 3)
    } finally {
      await Deno.remove(fixtureRoot, { recursive: true })
    }
  },
)
