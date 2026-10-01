import { assert, assertEquals } from '@std/assert'
import { dirname, join, resolve } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { alignZanixPackagesToProject } from 'commands/space/shared/project-dependency-alignment.ts'
import {
  type DenoLockFile,
  locateCliLockPath,
  NATIVE_FRESHNESS_REEXEC_ENV,
  prepareNativeFreshnessReexec,
} from 'commands/space/shared/native-dependency-freshness.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)
const SPACE_SPECIFIER = 'jsr:@zanix/space@^1.6.0'

/**
 * Real, network-backed coverage of `alignZanixPackagesToProject`: the project's `@zanix/space` version is
 * whatever its own loader resolves against the registry, and the target package's lock block comes
 * from an isolated `deno info` probe. The lock under test is passed in directly, so nothing here
 * reads or writes `@zanix/cli`'s own lock.
 */
async function withProject(
  layout: 'plain' | 'workspace-member',
  imports: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const base = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    let root = base
    if (layout === 'workspace-member') {
      await Deno.writeTextFile(
        join(base, 'deno.json'),
        JSON.stringify({ workspace: ['./member'], minimumDependencyAge: 0 }),
      )
      root = join(base, 'member')
      await Deno.mkdir(root)
    }
    await Deno.writeTextFile(join(root, 'deno.json'), JSON.stringify({ imports }))
    await Deno.writeTextFile(join(root, 'space.app.ts'), '')
    await run(root)
  } finally {
    await Deno.remove(base, { recursive: true })
  }
}

function lockPinning(pin: string, range = SPACE_SPECIFIER): DenoLockFile {
  return { specifiers: { [range]: pin } }
}

for (const layout of ['plain', 'workspace-member'] as const) {
  Deno.test({
    name:
      `alignZanixPackagesToProject (${layout}): moves a differing pin to the project's version, with that ` +
      "version's own lock block, and leaves an already-aligned or non-admitting pin alone",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      // deno-lint-ignore no-await-in-loop -- one test per layout, each registered by the loop
      await withProject(layout, { '@zanix/space': SPACE_SPECIFIER }, async (root) => {
        const aligner = alignZanixPackagesToProject(root)

        const aligned = await aligner(lockPinning('1.6.0'))
        assert(aligned !== undefined, 'a pin older than the project version must be aligned')
        const projectVersion = aligned.updates.specifiers[SPACE_SPECIFIER]
        assert(/^1\.\d+\.\d+$/.test(projectVersion), projectVersion)
        assert(projectVersion !== '1.6.0')
        assert(`@zanix/space@${projectVersion}` in aligned.updates.jsr)
        assert(aligned.description.includes('1.6.0'))
        assert(aligned.description.includes(projectVersion))

        assertEquals(await aligner(lockPinning(projectVersion)), undefined)
        assertEquals(await aligner(lockPinning('1.6.0', 'jsr:@zanix/space@~1.6.0')), undefined)
        assertEquals(await aligner(lockPinning('0.5.0', 'jsr:@zanix/space@^0.5.0')), undefined)
        assertEquals(
          await aligner({ specifiers: { 'jsr:@zanix/server@^4.0.0': '4.0.0' } }),
          undefined,
        )
      })
    },
  })
}

Deno.test({
  name:
    'alignZanixPackagesToProject: a project that does not declare @zanix/space is never aligned',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withProject('plain', { '@std/path': 'jsr:@std/path@^1.0.0' }, async (root) => {
      assertEquals(await alignZanixPackagesToProject(root)(lockPinning('1.6.0')), undefined)
    })
  },
})

Deno.test({
  name:
    'alignZanixPackagesToProject: a range a published package pins for another @zanix/* package ' +
    'the project declares (@zanix/iam importing @zanix/space-ui) moves to the project version',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const imports = {
      '@zanix/space': SPACE_SPECIFIER,
      '@zanix/space-ui/preact': 'jsr:@zanix/space-ui@^2.5.0/preact',
    }
    await withProject('plain', imports, async (root) => {
      const aligned = await alignZanixPackagesToProject(root)({
        specifiers: {
          'jsr:@zanix/space-ui@^2.4.0': '2.4.3',
          'jsr:@zanix/space-ui@^2.3.0': '2.4.3',
        },
      })
      assert(aligned !== undefined, 'a space-ui pin older than the project version must be aligned')

      const version = aligned.updates.specifiers['jsr:@zanix/space-ui@^2.4.0']
      assert(/^2\.\d+\.\d+$/.test(version) && version !== '2.4.3', version)
      assertEquals(aligned.updates.specifiers['jsr:@zanix/space-ui@^2.3.0'], version)
      assert(`@zanix/space-ui@${version}` in aligned.updates.jsr)
      assert(
        aligned.description.includes(`@zanix/space-ui 2.4.3 but this project resolves ${version}`),
      )
      assert(!aligned.description.includes('@zanix/space '), 'an untracked package is not reported')
    })
  },
})

Deno.test({
  name: "alignZanixPackagesToProject: caches the project's versions next to the CLI lock and " +
    'refreshes them when the project config changes',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const cliLockPath = await locateCliLockPath()
    assert(cliLockPath, 'a local checkout always has its own deno.lock')
    const cachePath = join(dirname(cliLockPath), '.zanix-project-alignment-cache.json')
    const readEntry = async (root: string) =>
      (JSON.parse(await Deno.readTextFile(cachePath)) as Record<
        string,
        { fingerprint: string; versions: Record<string, string> }
      >)[resolve(root)]

    await withProject('plain', { '@zanix/space': SPACE_SPECIFIER }, async (root) => {
      const aligned = await alignZanixPackagesToProject(root)(lockPinning('1.6.0'))
      const first = await readEntry(root)
      assert(first, 'the resolution is cached under the project root')
      assertEquals(first.versions['@zanix/space'], aligned?.updates.specifiers[SPACE_SPECIFIER])

      assertEquals(await alignZanixPackagesToProject(root)(lockPinning('1.6.0')), aligned)
      assertEquals((await readEntry(root)).fingerprint, first.fingerprint, 'a hit keeps the entry')

      await Deno.writeTextFile(
        join(root, 'deno.json'),
        JSON.stringify({
          imports: { '@zanix/space': SPACE_SPECIFIER, '@std/path': 'jsr:@std/path@^1' },
        }),
      )
      await alignZanixPackagesToProject(root)(lockPinning('1.6.0'))
      assert(
        (await readEntry(root)).fingerprint !== first.fingerprint,
        'a config change refreshes it',
      )
    })
  },
})

Deno.test({
  name:
    'prepareNativeFreshnessReexec: an aligner result is merged into a copy of the CLI lock and ' +
    'reported as a reason',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (Deno.env.get(NATIVE_FRESHNESS_REEXEC_ENV)) return
    const result = await prepareNativeFreshnessReexec({
      align: () =>
        Promise.resolve({
          updates: {
            specifiers: { 'jsr:@zanix/space@^0.0.1': '0.0.2' },
            jsr: { '@zanix/space@0.0.2': { integrity: 'x' } },
            npm: {},
          },
          description: 'alignment-marker',
        }),
    })
    assert(result !== undefined)
    try {
      assert(result.reasons.includes('alignment-marker'))
      const merged = JSON.parse(await Deno.readTextFile(result.lockPath)) as DenoLockFile
      assertEquals(merged.specifiers?.['jsr:@zanix/space@^0.0.1'], '0.0.2')
      assert('@zanix/space@0.0.2' in (merged.jsr ?? {}))
      assert(Object.keys(merged.specifiers ?? {}).length > 1, 'the CLI lock entries are kept')
    } finally {
      await Deno.remove(result.lockPath).catch(() => {})
    }
  },
})
