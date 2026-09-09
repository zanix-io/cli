import { dirname, join, resolve as resolvePath } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'

/**
 * Locates the `deno.json(c)` that governs a given project directory — the shared, low-level
 * building block every specifier-resolution concern in this package's own `commands/space/shared/`
 * tree (the `cli`-loader, specifier-reconstruction, transitive-collision, and
 * `importProjectDependency`/`importProjectModule` modules) is built on top of.
 *
 * @module
 */

/** Walks up from `startDir` looking for the nearest `deno.json`/`deno.jsonc`, preferring a
 * `"workspace"`-bearing config over the nearest plain one — a workspace root is what actually
 * governs resolution for every member underneath it. A cheap substring check, not a full JSONC
 * parse: this only needs to notice the key's presence, never its value. Returns `undefined` when
 * nothing is found anywhere above `startDir`, letting `Workspace` fall back to its own default
 * auto-discovery. */
export function findDenoConfigPath(startDir: string): string | undefined {
  let nearest: string | undefined
  let dir = resolvePath(startDir)
  const fsRoot = resolvePath('/')

  while (true) {
    for (const name of ['deno.json', 'deno.jsonc']) {
      const candidate = join(dir, name)
      let content: string
      try {
        content = Deno.readTextFileSync(candidate)
      } catch {
        continue
      }
      nearest ??= candidate
      if (/["']workspace["']\s*:/.test(content)) return candidate
    }
    if (dir === fsRoot) break
    dir = dirname(dir)
  }
  return nearest
}

/** The NEAREST `deno.json(c)` to `startDir`, never a workspace root further up — the one real
 * difference from {@linkcode findDenoConfigPath}, whose own workspace preference is deliberately
 * wrong for this specific need. A workspace MEMBER project (e.g. `zanix new space` scaffolded
 * inside a real Deno workspace) genuinely declares its own direct `@zanix/*` imports in its OWN
 * `deno.json` — the workspace root a member sits under commonly declares none of its own at all
 * (only a `"scopes"` block, or nothing), since each member's own config is what actually governs
 * that member's own specifier resolution day to day. A caller reading `imports` from whatever
 * {@linkcode findDenoConfigPath} returns for a member project would silently see `{}` instead —
 * confirmed, not hypothetical: a real workspace member declaring both `@zanix/space` and
 * `@zanix/server` directly (the exact shape a real transitive-collision risk needs) still read as
 * "nothing declared" this way, since the workspace root it sits under has no top-level `imports`
 * of its own. `detectTransitiveCollisionPackages`/`prepareTransitiveCollisionReexec` need the
 * member's own answer specifically — collision detection is about what THIS project directly
 * imports, never about the shared workspace root's own (possibly empty) declarations. */
export function findNearestPlainConfigPath(startDir: string): string | undefined {
  let dir = resolvePath(startDir)
  const fsRoot = resolvePath('/')

  while (true) {
    for (const name of ['deno.json', 'deno.jsonc']) {
      const candidate = join(dir, name)
      try {
        Deno.readTextFileSync(candidate)
      } catch {
        continue
      }
      return candidate
    }
    if (dir === fsRoot) break
    dir = dirname(dir)
  }
  return undefined
}

/** Converts a `deno.json(c)`'s own `"minimumDependencyAge"` field into the `newestDependencyDate`
 * cutoff `@deno/loader`'s own `Workspace` accepts. `@deno/loader`'s own config-file discovery
 * (`configPath`) reads a project's `imports`/`compilerOptions`/etc. automatically, but never
 * translates this ONE field on its own: a project's own `"minimumDependencyAge": 0` has zero
 * effect on a `Workspace` constructed from its `configPath` alone, still rejecting a
 * same-day-published dependency with Deno's own default 24h window. Every `Workspace` this
 * package's own resolution modules construct needs this computed and passed explicitly instead.
 * Supports the two shapes this ecosystem's own configs actually use — a plain number (minutes,
 * matching `deno install --min-dep-age`'s own numeric form) and an absolute RFC3339 cutoff
 * date/timestamp string; an ISO-8601 duration string (`'P2D'`) isn't handled yet and falls back to
 * no override (Deno's own default) rather than throwing. Returns `undefined` — no override, Deno's
 * own default applies — when `configPath` is `undefined` (config-file discovery, not a specific
 * file this function could read) or the file has no recognized `minimumDependencyAge`. */
export function readNewestDependencyDate(configPath: string | undefined): Date | undefined {
  if (!configPath) return undefined
  let config: { minimumDependencyAge?: number | string }
  try {
    config = parseJsonc(Deno.readTextFileSync(configPath)) as typeof config
  } catch {
    return undefined
  }
  const value = config.minimumDependencyAge
  if (typeof value === 'number') return new Date(Date.now() - value * 60_000)
  if (typeof value === 'string') {
    const asDate = new Date(value)
    if (!Number.isNaN(asDate.getTime())) return asDate
  }
  return undefined
}
