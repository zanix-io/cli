import { assertEquals, assertStringIncludes } from '@std/assert'
import { resolve } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { buildHarnessSource, findConfirmedFindings } from 'commands/check-cycles/lib/analyze.ts'
import type { Cycle } from 'commands/check-cycles/lib/cycles.ts'
import type { SpecifierResolutions } from 'commands/check-cycles/lib/graph.ts'

// Verifies that `runHarness` (`analyze.ts`) generates a real, local `.test.ts` file to spawn as
// its `deno test` subprocess target, importing `analyze-file.ts` via `import.meta.resolve` rather
// than `fromFileUrl(import.meta.url)`. This test exercises a real subprocess invocation of the
// harness (never a mock — a mock can't observe whether the generated file actually resolves and
// runs), proving the harness spawns and runs correctly for a local checkout.

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
  'findConfirmedFindings: runHarness spawns its subprocess and resolves a real finding',
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

// This is the real regression test for the bug `runHarness` used to have: `fromFileUrl(new
// URL('./side-effects/analyze-file.ts', import.meta.url))` throws `TypeError: Must be a file URL`
// the moment `@zanix/cli` itself loads from a REMOTE specifier — confirmed real via `deno run -A
// jsr:@zanix/cli check-cycles` (this command's own documented, CI-recommended invocation) against
// any repo with a real intra-package cycle (`@zanix/asyncmq`, `@zanix/datamaster`, both harmless).
// `buildHarnessSource` is what `runHarness` actually writes to its generated temp file, so
// generating one against a REAL published `https://jsr.io/...` specifier (never a mock — a mock
// can't observe whether a genuinely remote specifier resolves and runs inside a real `deno test`
// subprocess) and spawning it exactly as `runHarness` does proves the fix holds for the exact
// scenario that broke before.
Deno.test(
  'buildHarnessSource: the generated harness runs correctly when analyze-file.ts resolves to a real remote (non-file) specifier',
  async () => {
    const remoteAnalyzeFileSpecifier =
      'https://jsr.io/@zanix/cli/2.0.8/src/commands/check-cycles/lib/side-effects/analyze-file.ts'
    const harnessPath = await Deno.makeTempFile({ suffix: '.test.ts' })
    const outputPath = await Deno.makeTempFile({ suffix: '.json' })
    const targetPath = resolve(getTemporaryFolder(import.meta.url), 'remote-harness-fixture.ts')

    try {
      await Deno.mkdir(getTemporaryFolder(import.meta.url), { recursive: true })
      await Deno.writeTextFile(targetPath, `export function noop() {}\n`)
      await Deno.writeTextFile(harnessPath, buildHarnessSource(remoteAnalyzeFileSpecifier))

      const command = new Deno.Command(Deno.execPath(), {
        args: ['test', '-A', '--no-check', harnessPath],
        env: {
          ZNX_CHECK_CYCLES_FILES: JSON.stringify([targetPath]),
          ZNX_CHECK_CYCLES_OUTPUT: outputPath,
        },
        stdout: 'piped',
        stderr: 'piped',
      })

      const { success, stderr } = await command.output()
      assertEquals(success, true, new TextDecoder().decode(stderr))

      const raw = await Deno.readTextFile(outputPath)
      assertStringIncludes(raw, targetPath)
    } finally {
      await Deno.remove(harnessPath).catch(() => {})
      await Deno.remove(outputPath).catch(() => {})
      await Deno.remove(targetPath).catch(() => {})
    }
  },
)
