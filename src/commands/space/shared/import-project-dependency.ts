import { type Loader, ResolutionMode } from '@deno/loader'
import { resolve as resolvePath, toFileUrl } from '@std/path'
import { isFileUrl } from '@zanix/helpers'
import { findDenoConfigPath } from 'commands/space/shared/deno-config-discovery.ts'
import { getLoaderFor } from 'commands/space/shared/cli-loader.ts'
import {
  reconstructNpmSpecifierFromResolvedPath,
  reconstructSchemeSpecifier,
  splitPackageSpecifier,
} from 'commands/space/shared/specifier-reconstruction.ts'
import { detectTransitiveCollisionPackages } from 'commands/space/shared/transitive-collision.ts'

/**
 * Imports a BARE package specifier `space.app.ts` itself directly declares (`@zanix/space`,
 * `@zanix/space/dev`, `@zanix/space/vite`) — never a project FILE, see `import-project-module.ts`'s
 * own `importProjectModule` for that — resolved against `root`'s own nearest `deno.json(c)`, and
 * returns its module namespace.
 *
 * Exists for the same reason `importProjectModule` resolves a project FILE's own bare specifiers
 * against that project's config instead of `@zanix/cli`'s: `@zanix/cli` itself natively imports
 * `@zanix/space` for its own dev/build orchestration (`createSpaceDevEngine`, `getRoutesDir`, ...),
 * and shares real, module-level protocol state through it with whatever the served project's own
 * `space.app.ts` imports (a renderer registry, a route registry, ...). A plain
 * `import('@zanix/space/dev')` from inside `@zanix/cli`'s own process resolves against WHATEVER
 * config governs that already-running process — for a real global install, the shim's own
 * separately generated, fixed lockfile, completely independent of any served project's own
 * declared version. When that diverges from what the project itself resolves through
 * `importProjectModule`, Deno loads TWO separate module instances of the same package:
 * `SpaceDevSocket`'s own static class initializer runs once per instance, each registering the
 * identical dev-socket route into `@zanix/server`'s ONE shared route registry — the second
 * registration throws `Route path "socket=>/__zanix_space_dev__" is already defined`. Resolving
 * `@zanix/cli`'s own native orchestration imports of `@zanix/space` THROUGH this function instead
 * converges both onto the identical resolved URL (and therefore the identical Deno module-cache
 * key), with no floor for `@zanix/cli` to keep in sync at all: it simply never holds an opinion on
 * this package's version, in any install shape.
 *
 * **Does NOT cover `@zanix/server`/`@zanix/app`/`@zanix/app/runtime`** — `space.app.ts` never
 * declares any of the three itself (only transitively, through `@zanix/space`'s own internal
 * imports), so there is no project-declared version for a resolution anchored against `root`'s own
 * config to converge with in the first place. `dev/action.ts` and `import-space-app.ts` resolve
 * those three through a plain NATIVE `import()` of their own instead — see the comment at each of
 * those call sites for why that mechanism, not this function, is what actually converges with
 * whatever `@zanix/space`'s own internal imports of them resolve to.
 *
 * @module
 */

/** The literal filename every `zanix space` project's manifest lives at, at its root — kept in
 * sync BY HAND with `SPACE_APP_MODULE` (`commands/new/lib/tree/projects/space.ts`), never
 * imported from there: that module's own real top-level imports (the whole `zanix new` tree/
 * generator graph) have no business loading into this comparatively lightweight, broadly-reused
 * module just to read one string constant back out of it. Used purely as a referrer file for
 * `importProjectDependency`'s own `@zanix/space` resolution — confirmed empirically that a real
 * referrer isn't even load-bearing here (`@deno/loader`'s own `resolveSync` returns the identical
 * result for a bare specifier whether or not the referrer path actually exists on disk), but every
 * real call site already has this exact file guaranteed to exist by the time it calls this
 * function (after `importSpaceApp`/`importProjectModule` on it already succeeded), so there's no
 * reason to invent a synthetic path instead. */
const PROJECT_MANIFEST_FILE = 'space.app.ts'

/** Resolves `specifier` through `loader`, forcing the real dependency-constraint solve for an
 * unexpanded `jsr:`/`http(s):` literal (same gap `import-project-module.ts`'s own `resolveReplacement`
 * project-resolution branch already documents in full), and reconstructing a scheme-based
 * specifier when the result lands in `node_modules` (same CJS/ESM-interop gap that same function's
 * own `node_modules` branch already guards against) — the two pieces of the resolution dance
 * {@linkcode importProjectDependency} needs twice, factored out so neither copy drifts from the
 * other. Returns a URL always safe to hand to native `import()` directly.
 *
 * **Except** when `specifier`'s base package is in `collisionPackages` (see
 * {@linkcode detectTransitiveCollisionPackages}'s own doc for what that set means and why): the
 * force-solve step is skipped entirely, returning the unexpanded `jsr:`/`http(s):` literal as-is.
 * This deliberately reintroduces the exact gap this function's own first paragraph closes
 * (`"minimumDependencyAge"` has no effect on the specifier this returns) for this one, narrow,
 * flagged case — see `resolveReplacement`'s matching branch for the full reasoning: a
 * pre-resolved, fixed URL for a package ALSO reachable as a transitive dependency of another
 * directly-imported package can silently diverge from whatever THAT package's own manifest
 * resolves the same name to, loading two separate module instances of it. Leaving it unexpanded
 * instead hands the real version-constraint solve to native `import()` itself, which — run under
 * `prepareTransitiveCollisionReexec`'s re-exec'd process — sees both edges in the SAME graph and
 * unifies them the way any ordinary Deno project's dependency resolution already would. */
async function resolveProjectSpecifier(
  loader: Loader,
  referrerUrl: string,
  configPath: string | undefined,
  specifier: string,
  collisionPackages: Set<string>,
): Promise<string> {
  let resolved: string
  try {
    resolved = loader.resolveSync(specifier, referrerUrl, ResolutionMode.Import)
    const isUnresolvedLiteral = resolved.startsWith('jsr:') || resolved.startsWith('http:') ||
      resolved.startsWith('https:')
    if (isUnresolvedLiteral && collisionPackages.has(splitPackageSpecifier(specifier).base)) {
      return resolved
    }
    if (isUnresolvedLiteral) {
      await loader.addEntrypoints([resolved])
      resolved = loader.resolveSync(resolved, referrerUrl, ResolutionMode.Import)
    }
  } catch (error) {
    const literal = configPath ? reconstructSchemeSpecifier(configPath, specifier) : undefined
    if (literal === undefined) {
      throw new Error(
        `Could not resolve '${specifier}' relative to '${referrerUrl}': ${
          (error as Error).message
        }`,
      )
    }
    return literal
  }

  if (isFileUrl(resolved) && resolved.includes('/node_modules/')) {
    const reconstructed = (configPath && reconstructSchemeSpecifier(configPath, specifier)) ??
      reconstructNpmSpecifierFromResolvedPath(resolved, specifier)
    return reconstructed ?? resolved
  }
  return resolved
}

/**
 * `@zanix/space` itself (bare, or a subpath like `@zanix/space/dev`/`@zanix/space/vite`) resolves
 * relative to `space.app.ts` — the one file every real project is guaranteed to both have and
 * directly import `@zanix/space` from, so `root`'s own real `deno.json(c)` always has a real
 * answer for it, no augmentation needed.
 *
 * No relative-import rewriting, no `ImportBatchContext` — unlike a real project FILE, a bare
 * package specifier has no relative imports of its own to recurse into or dedupe against a batch.
 */
export async function importProjectDependency(
  root: string,
  specifier: string,
): Promise<Record<string, unknown>> {
  const configPath = findDenoConfigPath(root)
  const loader = await getLoaderFor(configPath)
  const manifestReferrer = toFileUrl(resolvePath(root, PROJECT_MANIFEST_FILE)).href
  const collisionPackages = await detectTransitiveCollisionPackages(root)

  // Graph @zanix/space FIRST, on THIS loader, before resolving a subpath of it — a subpath
  // specifier (`@zanix/space/dev`, `@zanix/space/vite`) resolves reliably once the base package
  // is already part of this loader's own dependency-constraint solve. A no-op extra round-trip
  // when `specifier` IS `@zanix/space` itself — harmless, and simpler than special-casing it away.
  await resolveProjectSpecifier(
    loader,
    manifestReferrer,
    configPath,
    '@zanix/space',
    collisionPackages,
  )

  const resolved = await resolveProjectSpecifier(
    loader,
    manifestReferrer,
    configPath,
    specifier,
    collisionPackages,
  )
  return await import(resolved) as Record<string, unknown>
}
