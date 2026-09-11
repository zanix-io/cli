import { dirname, join, resolve as resolvePath, toFileUrl } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'
import { findNearestPlainConfigPath } from 'commands/space/shared/deno-config-discovery.ts'
import { getCliConfigPath } from 'commands/space/shared/cli-loader.ts'
import {
  GENERATED_MODULE_PREFIX,
  splitPackageSpecifier,
} from 'commands/space/shared/specifier-reconstruction.ts'
import { recordGeneratedModuleDir } from 'commands/space/shared/generated-module-dirs-manifest.ts'

/**
 * Detects, and repairs, a real `@zanix/*` module-identity hazard: a served project importing a
 * package BOTH directly AND transitively through a third-party `@zanix/*` package it also imports
 * directly (e.g. a project directly importing `@zanix/server` alongside `@zanix/datamaster`, whose
 * own published `deno.jsonc` declares `"@zanix/server": "jsr:@zanix/server@^4.0.0"` internally).
 * The project's own direct edge and the third-party package's own internal edge can then resolve
 * through two entirely separate mechanisms, landing on two different concrete versions even when
 * both ranges are semver-compatible today — a version bump on either side can split them apart
 * later with zero code change on the served project's own end.
 *
 * `detectTransitiveCollisionPackages` is the pure detection half — a real, live `deno info --json`
 * probe over the project's own direct `@zanix/*` imports, walking the resolved module graph for a
 * package reachable both directly and through a DIFFERENT direct import. `prepareTransitiveCollisionReexec`
 * is the remediation half: when a risk is found, it merges `@zanix/cli`'s own `"imports"` with the
 * project's own (project wins on any name collision) into one config, for the caller
 * (`transitive-collision-guard.ts`) to re-exec the whole process under.
 *
 * @module
 */

/** Minimal shape of `deno info --json`'s own module graph output this file needs — a resolved
 * module's specifier and the resolved specifier of each of its own dependencies. Deliberately a
 * fresh, narrow local type rather than a shared one: `check-cycles/lib/graph.ts` has an equivalent
 * shape for its own, unrelated intra-repo-cycle concern, but importing across command boundaries
 * for a type this small would add a dependency neither command actually needs on the other. */
type DenoInfoModule = {
  specifier: string
  // `specifier` here is the raw, as-written import text (`'@zanix/server'`) — used to attribute
  // an edge back to the package base that declared it, by IDENTITY rather than by array
  // position (`deno info --json`'s own dependency-array order is not a documented guarantee).
  dependencies?: Array<{ specifier?: string; code?: { specifier?: string } }>
}
/** `redirects` maps every UNEXPANDED literal `deno info --json` encountered (`jsr:@zanix/server@
 * ^4.0.0`, the raw import-map/manifest-declared value) to its actual resolved module URL
 * (`https://jsr.io/@zanix/server/4.2.3/mod.ts`) — a dependency edge's own `code.specifier` is
 * frequently still the UNEXPANDED form (confirmed empirically: an open-range bare import stays
 * literal in `dependencies[]`, never eagerly resolved there), so every specifier this detection
 * collects must be run through this map before comparing/walking it as a real module identity. */
type DenoInfoOutput = { modules?: DenoInfoModule[]; redirects?: Record<string, string> }

/** Extracts a JSR package's `@scope/name` base and resolved version from one of its own module
 * URLs (`https://jsr.io/@scope/name/version/...`) — `undefined` for anything else (an `npm:`
 * specifier, a local `file://` path, `@std/*`, ...), which this detection has no need to track. */
const JSR_MODULE_URL_RE = /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\//

function jsrPackageBaseFromResolvedUrl(url: string): string | undefined {
  return JSR_MODULE_URL_RE.exec(url)?.[1]
}

/** One in-memory result per `root` — computed at most once per process, matching every other
 * cache in this package's own resolution modules. */
const collisionPackagesByRoot = new Map<string, Promise<Set<string>>>()

/**
 * The base package names (`@scope/name`) `root` genuinely risks a dual-module-instance split for
 * — see this module's own doc for the full mechanism.
 *
 * Best-effort: returns an empty set (never throws) when the project has no config, fewer than two
 * direct `@zanix/*` imports (nothing that could collide), or the `deno info --json` probe itself
 * fails for any reason (network hiccup, an unpublished/unreachable package) — this detection is a
 * pure diagnostic aid, and must never be what blocks `zanix space dev`/`build` from starting.
 */
export function detectTransitiveCollisionPackages(root: string): Promise<Set<string>> {
  let pending = collisionPackagesByRoot.get(root)
  if (!pending) {
    pending = (async () => {
      const empty = new Set<string>()
      // `findNearestPlainConfigPath`, never `findDenoConfigPath` — this detection needs to know
      // what THIS project directly declares (see that function's own doc for why a workspace
      // member's own answer is genuinely different from its workspace root's).
      const configPath = findNearestPlainConfigPath(root)
      if (!configPath) return empty

      let parsed: Record<string, unknown>
      try {
        parsed = parseJsonc(await Deno.readTextFile(configPath)) as Record<string, unknown>
      } catch {
        return empty
      }
      const imports = (parsed.imports as Record<string, string> | undefined) ?? {}
      const directBases = [
        ...new Set(
          Object.keys(imports)
            .filter((specifier) => specifier.startsWith('@zanix/'))
            .map((specifier) => splitPackageSpecifier(specifier).base),
        ),
      ]
      // Need at least two direct @zanix/* imports for one to possibly carry another transitively.
      if (directBases.length < 2) return empty

      const configDir = dirname(configPath)
      // `.js`, not `.ts` — plain `import 'pkg'` statements need no TypeScript syntax at all, and
      // `.js` is what GENERATED_MODULE_MATCH (sweepStaleGeneratedModules's own orphan-cleanup
      // regex) actually matches; a `.ts` orphan left behind by a killed process (before the
      // `finally` below removes it) would otherwise never be swept.
      const entryPath = join(
        configDir,
        `${GENERATED_MODULE_PREFIX}collision-check-${crypto.randomUUID()}.js`,
      )
      await Deno.writeTextFile(
        entryPath,
        directBases.map((base) => `import ${JSON.stringify(base)}`).join('\n'),
      )
      // Awaited before the `deno info` subprocess below — a kill right after the write still
      // leaves `configDir` recorded. See `recordGeneratedModuleDir`'s own doc: `configDir` can be a
      // LINKED sibling's own directory, entirely outside the served project's structural sweep
      // scope, the same gap `import-project-module.ts`'s own `writeGeneratedModule` has.
      await recordGeneratedModuleDir(configDir)

      let info: DenoInfoOutput
      let entryUrl: string
      try {
        // Realpath'd before spawning — `root` (and therefore `configDir`/`entryPath`) can sit
        // under a symlinked ancestor (macOS's own `/tmp` → `/private/tmp`, `/var` →
        // `/private/var`, the same class of footgun `discoverComets`'s own doc already documents
        // elsewhere in this ecosystem), and a real, confirmed case exists where that breaks THIS
        // specific subprocess: a `deno info` child process spawned with the symlinked (non-
        // realpath'd) form as its own `cwd`, for a workspace MEMBER project, silently fails to
        // recognize itself as a member of its own ancestor workspace root at all — every
        // specifier then resolves as `"not a dependency and not in import map"`, indistinguishable
        // from a project with no config whatsoever, even though the same command against the
        // REALPATH'd form resolves correctly. `entryUrl` is rebuilt from the realpath'd form too:
        // `deno info --json`'s own `"roots"`/module `specifier` fields always report the
        // REALPATH'd URL regardless of which form was passed in, so comparing against a
        // non-realpath'd `entryUrl` would silently never match `entryModule` below, on any
        // filesystem where `root` sits under a symlink — not just the workspace-member shape this
        // was actually caught against.
        const realEntryPath = await Deno.realPath(entryPath)
        entryUrl = toFileUrl(realEntryPath).href
        const command = new Deno.Command(Deno.execPath(), {
          args: ['info', '--json', realEntryPath],
          cwd: dirname(realEntryPath),
          stdout: 'piped',
          stderr: 'piped',
        })
        const { success, stdout } = await command.output()
        if (!success) return empty
        info = JSON.parse(new TextDecoder().decode(stdout)) as DenoInfoOutput
      } catch {
        return empty
      } finally {
        await Deno.remove(entryPath).catch(() => {})
      }

      const redirects = info.redirects ?? {}
      const resolveEdge = (specifier: string): string => redirects[specifier] ?? specifier

      const dependenciesBySpecifier = new Map<string, string[]>()
      for (const mod of info.modules ?? []) {
        dependenciesBySpecifier.set(
          mod.specifier,
          (mod.dependencies ?? [])
            .map((dep) => dep.code?.specifier)
            .filter((s): s is string => !!s)
            .map(resolveEdge),
        )
      }

      // Attributed by IDENTITY — each dependency's own raw `specifier` (`'@zanix/server'`) matched
      // back to the base it was declared for — never by array position/order, which `deno info
      // --json` documents no guarantee for.
      const entryModule = info.modules?.find((mod) => mod.specifier === entryUrl)
      const directRootByBase = new Map<string, string>()
      for (const dep of entryModule?.dependencies ?? []) {
        if (!dep.specifier || !dep.code?.specifier) continue
        const base = splitPackageSpecifier(dep.specifier).base
        if (directBases.includes(base)) directRootByBase.set(base, resolveEdge(dep.code.specifier))
      }
      if (directRootByBase.size !== directBases.length) return empty // resolution failed for one

      // Grouped by each base's own REAL resolved package identity — never by the raw declared key
      // name alone. A project frequently declares a package only under a SUBPATH ALIAS
      // (`"@zanix/errors": "jsr:@zanix/utils@^X/errors"`, `"@zanix/validator": ".../validator"`,
      // `"@zanix/helpers": ".../helpers"` — a real, confirmed, widely-used convention), never its
      // own bare name (`@zanix/utils` itself might not appear as a literal top-level key at all).
      // Comparing the walk below against the raw alias key directly would never match
      // `jsrPackageBaseFromResolvedUrl`'s own output, which always reports the REAL published
      // package name from a resolved `jsr.io` URL — silently missing a genuine collision whenever
      // every direct edge into a colliding package happens to be alias-only. Resolving each base's
      // own root back to its real identity first (falling back to the base itself for a `npm:`/
      // local-path root, which `jsrPackageBaseFromResolvedUrl` doesn't recognize anyway) closes that
      // gap, and also correctly treats two aliases of the SAME real package
      // (`@zanix/errors`/`@zanix/validator`, both `@zanix/utils`) as NOT colliding with each other —
      // they already share one instance by construction, nothing to converge.
      const basesByRealIdentity = new Map<string, string[]>()
      for (const [base, root] of directRootByBase) {
        const realIdentity = jsrPackageBaseFromResolvedUrl(root) ?? base
        const group = basesByRealIdentity.get(realIdentity)
        if (group) group.push(base)
        else basesByRealIdentity.set(realIdentity, [base])
      }

      const collisions = new Set<string>()
      for (const [realIdentity, aliasBases] of basesByRealIdentity) {
        for (const [otherBase, otherRoot] of directRootByBase) {
          if (aliasBases.includes(otherBase) || aliasBases.some((base) => collisions.has(base))) {
            continue
          }
          // BFS from `otherBase`'s OWN root, looking for an edge whose REAL package identity is
          // `realIdentity` — i.e. this package reachable transitively FROM a DIFFERENT direct
          // import, not from itself (or from another alias of the same real package).
          const seen = new Set<string>()
          const queue = [otherRoot]
          while (queue.length > 0) {
            const current = queue.shift() as string
            if (seen.has(current)) continue
            seen.add(current)
            if (jsrPackageBaseFromResolvedUrl(current) === realIdentity) {
              // Every alias sharing this real identity is an equally valid answer to "is THIS
              // specifier a collision risk" for `import-project-module.ts`/
              // `import-project-dependency.ts`'s own per-specifier lookups (`collisions.has(base)`,
              // matched against whatever alias a project file actually imports) — flag them all,
              // not just whichever alias happened to be checked first.
              for (const base of aliasBases) collisions.add(base)
              break
            }
            for (const dep of dependenciesBySpecifier.get(current) ?? []) queue.push(dep)
          }
        }
      }
      return collisions
    })()
    collisionPackagesByRoot.set(root, pending)
  }
  return pending
}

/** Guard env var a caller MUST set (to `'1'`, or any truthy string) on the re-exec'd child process
 * it spawns from a {@linkcode prepareTransitiveCollisionReexec} result, so that child never tries
 * to re-exec again for the same reason — detection is purely structural, independent of which
 * config governs the CURRENT process, so it would otherwise re-detect the identical collision set
 * every time and loop forever. Exported so `dev/action.ts`/`build/action.ts` set the exact same
 * name this function itself checks. */
export const TRANSITIVE_REEXEC_ENV = 'ZANIX_TRANSITIVE_COLLISION_REEXEC'

/**
 * When {@linkcode detectTransitiveCollisionPackages} finds a real risk for `root`, merges
 * `@zanix/cli`'s OWN `"imports"` with `root`'s own real config's `"imports"` (the project's own
 * value always wins on a name collision) into one config file, written as a real, uncommitted
 * temporary sibling of the project's own config (same `GENERATED_MODULE_PREFIX` convention as
 * `import-project-module.ts`'s own `writeGeneratedModule` temp files); left on disk for
 * `sweepStaleGeneratedModules` to clean up on a later run, since it needs to keep existing for the
 * re-exec'd process's entire lifetime, not just until this function returns.
 */
export async function prepareTransitiveCollisionReexec(root: string): Promise<string | undefined> {
  if (Deno.env.get(TRANSITIVE_REEXEC_ENV)) return undefined

  const collisions = await detectTransitiveCollisionPackages(root)
  if (collisions.size === 0) return undefined

  // `findNearestPlainConfigPath`, matching `detectTransitiveCollisionPackages`'s own choice —
  // the merged config below needs the SAME project-declared `imports` that detection itself just
  // read, never the (possibly import-less) workspace root `findDenoConfigPath` would prefer.
  const configPath = findNearestPlainConfigPath(root)
  if (!configPath) return undefined

  let projectParsed: Record<string, unknown>
  try {
    projectParsed = parseJsonc(await Deno.readTextFile(configPath)) as Record<string, unknown>
  } catch {
    return undefined
  }

  let cliImports: Record<string, string> = {}
  const cliConfigPath = getCliConfigPath()
  if (cliConfigPath) {
    try {
      const cliParsed = parseJsonc(await Deno.readTextFile(cliConfigPath)) as Record<
        string,
        unknown
      >
      const rawCliImports = (cliParsed.imports as Record<string, string> | undefined) ?? {}
      // A RELATIVE value (`"commands/": "./src/commands/"`, cli's own internal path aliases —
      // (written as a sibling of the SERVED PROJECT's own config, per this function's own doc)
      // resolves that SAME relative text against the PROJECT's own directory instead of cli's,
      // throwing `Module not found ".../<project>/src/commands/new/main.ts"` the moment cli's own
      // internal `commands/new/main.ts`-style import runs) is rewritten to an absolute `file://`
      // URL anchored at `cliConfigPath`'s OWN directory — exactly what `deno.json(c)` "imports"
      // already does natively for a relative value, just computed here instead of left to Deno's
      // own (config-file-relative, not merged-file-relative) resolution. A scheme-based value
      // (`jsr:`/`npm:`/`https:`) needs no anchoring at all and is kept as-is.
      const cliConfigDir = dirname(cliConfigPath)
      cliImports = Object.fromEntries(
        Object.entries(rawCliImports).map(([key, value]) => {
          if (!value.startsWith('./') && !value.startsWith('../')) return [key, value]
          // `resolvePath`/`toFileUrl` both normalize away a trailing slash — re-appended when the
          // original value had one, since a folder-prefix mapping (`"commands/": "./src/commands/"`)
          // needs it on BOTH sides to keep Deno's own prefix-matching semantics, not just resolve
          // to a single, non-existent file path.
          const anchored = toFileUrl(resolvePath(cliConfigDir, value)).href
          return [key, value.endsWith('/') ? `${anchored}/` : anchored]
        }),
      )
    } catch {
      // Best-effort — a missing/unreadable cli config just means nothing to merge from it.
    }
  }

  const projectImports = (projectParsed.imports as Record<string, string> | undefined) ?? {}
  const mergedImports = { ...cliImports, ...projectImports }

  const mergedPath = join(
    dirname(configPath),
    `${GENERATED_MODULE_PREFIX}reexec-${crypto.randomUUID()}.json`,
  )
  await Deno.writeTextFile(mergedPath, JSON.stringify({ ...projectParsed, imports: mergedImports }))
  return mergedPath
}
