import { assertEquals } from '@std/assert'
import { resolve } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { findConfirmedFindings } from 'commands/check-cycles/lib/analyze.ts'
import type { Cycle } from 'commands/check-cycles/lib/cycles.ts'
import type { SpecifierResolutions } from 'commands/check-cycles/lib/graph.ts'

// Verifies that `runHarness` (`analyze.ts`) resolves its own harness script path lazily, inside
// the function itself, never at module top level: a top-level `fromFileUrl(import.meta.url)` call
// only works when the module loads from a real `file://` URL (a local checkout) — once installed
// globally from JSR (`deno install -g jsr:@zanix/cli`), this module loads from an
// `https://jsr.io/...` specifier instead, and a top-level call throws `TypeError: Must be a file
// URL` on every `zanix` invocation, not just `check-cycles`, since `commands/mod.ts` eagerly
// imports every command's own module to register its CLI surface. This test exercises a real
// subprocess invocation of the harness (never a mock — a mock can't observe whether the lazily
// computed path actually resolves and runs), proving the harness spawns and runs correctly with
// it.

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
