import { fromFileUrl, resolve, toFileUrl } from '@std/path'

/** Directed intra-repo import graph — absolute file path to the set of absolute file paths it
 * imports, restricted to files under the checked repo's own root. Cross-repo (`@zanix/*`, `jsr:`,
 * `npm:`, `https:`) edges never appear here — checking those is a separate, cross-package
 * concern, not this one. */
export type ImportGraph = Map<string, Set<string>>

/** Per file, the RAW specifier text (`'./connector.ts'`, or an aliased bare specifier like
 * `'modules/logger/main.ts'` — this ecosystem uses both styles across different repos) mapped to
 * the resolved absolute path it points at, restricted to same-repo resolutions. `analyze.ts` uses
 * this to attribute an AST import's raw specifier to a real file WITHOUT re-implementing
 * `deno.json(c)` path-alias resolution itself — `deno info` already did that resolution
 * correctly; re-deriving it from a `./`/`../`-only heuristic would silently miss every
 * alias-style import (confirmed real: `@zanix/utils`'s own `logger/mod.ts` imports
 * `'modules/logger/main.ts'`, not `'./main.ts'`). */
export type SpecifierResolutions = Map<string, Map<string, string>>

type DenoInfoModule = {
  specifier: string
  dependencies?: Array<{ specifier?: string; code?: { specifier?: string } }>
}

type DenoInfoOutput = {
  modules?: DenoInfoModule[]
}

/**
 * Builds the intra-repo import graph from `deno info --json`'s real, resolved module graph — one
 * run per entrypoint, merged into a single graph — plus the raw-specifier resolution map every
 * file needs for `analyze.ts`'s own cross-referencing step.
 *
 * `deno info` resolves import-map/workspace-link entries too, not just plain relative imports —
 * in a real Zanix repo, a `@zanix/server` import resolves to the SIBLING repo's own absolute path
 * when a local workspace link is active, so filtering by "starts with `@zanix/`" would be wrong
 * (it can resolve outside `root` even when written as a bare specifier) and filtering by "is a
 * `file://` URL" alone would be wrong too (a linked sibling repo's files are real `file://` URLs,
 * just not under THIS repo's own root). The only correct filter is the resolved path's actual
 * prefix against `root`.
 */
export async function buildIntraRepoGraph(
  root: string,
  entrypoints: string[],
): Promise<{ graph: ImportGraph; specifierResolutions: SpecifierResolutions }> {
  const graph: ImportGraph = new Map()
  const specifierResolutions: SpecifierResolutions = new Map()
  const rootHref = toFileUrl(resolve(root)).href.replace(/\/?$/, '/')

  for (const entrypoint of entrypoints) {
    // deno-lint-ignore no-await-in-loop
    const info = await runDenoInfo(entrypoint, root)

    for (const mod of info.modules ?? []) {
      if (!mod.specifier?.startsWith(rootHref)) continue

      const modPath = fromFileUrl(mod.specifier)
      const deps = graph.get(modPath) ?? new Set<string>()
      const resolutions = specifierResolutions.get(modPath) ?? new Map<string, string>()

      for (const dep of mod.dependencies ?? []) {
        const depSpecifier = dep.code?.specifier
        if (depSpecifier?.startsWith(rootHref)) {
          const resolvedPath = fromFileUrl(depSpecifier)
          deps.add(resolvedPath)
          if (dep.specifier) resolutions.set(dep.specifier, resolvedPath)
        }
      }

      graph.set(modPath, deps)
      specifierResolutions.set(modPath, resolutions)
    }
  }

  return { graph, specifierResolutions }
}

async function runDenoInfo(entrypoint: string, root: string): Promise<DenoInfoOutput> {
  // `cwd` matters, not just cosmetically: `deno info` resolves the entrypoint's own import
  // map/path aliases (a `deno.json(c)` "imports" entry like `"modules/": "./src/modules/"`)
  // relative to its OWN process cwd, not relative to the entrypoint file's location — confirmed
  // empirically as a real bug, not a hypothetical: omitting this caused every bare/aliased
  // specifier in the checked repo to fail resolution (`"modules/logger/main.ts" not a dependency
  // and not in import map`), silently producing an empty dependency list for every such module
  // instead of an error, which made a real, confirmed cycle in `@zanix/utils` invisible.
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entrypoint],
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  })

  const { success, stdout, stderr } = await command.output()
  if (!success) {
    throw new Error(
      `'deno info --json ${entrypoint}' failed: ${new TextDecoder().decode(stderr)}`,
    )
  }

  return JSON.parse(new TextDecoder().decode(stdout)) as DenoInfoOutput
}
