import { dirname, join } from '@std/path'
import { getCliConfigPath } from 'commands/space/shared/cli-loader.ts'

/**
 * The write half of the global generated-module-directory manifest — split out of
 * `import-project-module.ts` (which owns the READ/sweep half, `sweepRegisteredGeneratedModuleDirs`)
 * so `transitive-collision.ts` can record its own `.zanix-import-collision-check-*.js` temp files
 * too, without creating an import cycle: `import-project-module.ts` already imports
 * `detectTransitiveCollisionPackages` FROM `transitive-collision.ts`.
 *
 * @module
 */

/** Filename of the global generated-module-directory manifest. */
const GENERATED_MODULE_DIRS_MANIFEST = 'generated-module-dirs.json'

/** Directory `@zanix/cli`'s own global shim (`deno install -g`) writes its own state under — same
 * formula `locateCliLockPath` uses for its own lock file. A local checkout uses `cliConfigPath`'s
 * own directory instead. */
function globalCliStateDir(): string {
  const configPath = getCliConfigPath()
  if (configPath) return dirname(configPath)
  const installRoot = Deno.env.get('DENO_INSTALL_ROOT') ??
    `${Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE')}/.deno`
  return `${installRoot}/bin/.zanix`
}

/** The manifest's real production path, computed fresh per call (`globalCliStateDir()` depends on
 * a lazily-computed result). {@linkcode recordGeneratedModuleDir} accepts an override instead of
 * always calling this, so a test can point at an isolated temp file — a real run never passes one. */
export function defaultGeneratedModuleDirsManifestPath(): string {
  return join(globalCliStateDir(), GENERATED_MODULE_DIRS_MANIFEST)
}

/** Every directory the manifest lists, or `[]` if it doesn't exist yet or is unreadable/corrupt —
 * never thrown. */
export async function readGeneratedModuleDirsManifest(manifestPath: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(manifestPath))
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

/** Directories already recorded THIS PROCESS — avoids re-reading/rewriting the manifest on every
 * call from the same directory. */
const recordedGeneratedModuleDirs = new Set<string>()

/**
 * Records `dir` — an absolute directory a caller just wrote a real `.zanix-import-*.js`/`.json`
 * temp file into — in a small, persistent, GLOBAL manifest (never scoped to the served project's
 * own `root`).
 *
 * This is what lets `sweepStaleGeneratedModules`/`sweepRegisteredGeneratedModuleDirs`
 * (`import-project-module.ts`) reach a LINKED/workspace sibling's own directory (a raw
 * relative-path `deno.json` override, e.g. `@zanix/space-ui` mapped to a local `../space-ui`
 * checkout — see `deno-workspace-link-pitfalls`), which sits outside `root`/`root/src` entirely.
 * Confirmed real: such orphans, once written, were never reached by any later
 * `zanix space dev`/`build` run of either project — both `import-project-module.ts`'s own
 * `writeGeneratedModule` AND `transitive-collision.ts`'s own collision-check temp file exhibit the
 * exact same gap, since both can write into a recursively-resolved sibling's directory.
 *
 * Best-effort and silent throughout: a failure to read/write the manifest is never a reason to fail
 * the real work this is a side effect of.
 *
 * @param manifestPathOverride - Test-only; a real run never passes this. */
export async function recordGeneratedModuleDir(
  dir: string,
  manifestPathOverride?: string,
): Promise<void> {
  if (recordedGeneratedModuleDirs.has(dir)) return
  recordedGeneratedModuleDirs.add(dir)
  try {
    const manifestPath = manifestPathOverride ?? defaultGeneratedModuleDirsManifestPath()
    await Deno.mkdir(dirname(manifestPath), { recursive: true })
    const dirs = new Set(await readGeneratedModuleDirsManifest(manifestPath))
    if (dirs.has(dir)) return
    dirs.add(dir)
    await Deno.writeTextFile(manifestPath, JSON.stringify([...dirs]))
  } catch {
    // Best-effort — worst case, this orphan (if any) waits for the structural scan instead; only a
    // LINKED SIBLING's directory genuinely depends on this manifest succeeding.
  }
}
