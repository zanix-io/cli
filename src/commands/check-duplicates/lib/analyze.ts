/** One `@zanix/*` package resolved to more than one distinct version at once — the real
 * dual-package-hazard shape: a downstream package (e.g. `@zanix/core`) still pins a pre-major
 * range (`~0.8.1`) for a dependency an app also pulls directly at a new major (`^1.0.0`); since
 * the ranges don't overlap, Deno keeps BOTH resolved versions live in the same `deno.lock`
 * instead of collapsing them into one. */
export interface DuplicateFinding {
  /** The `@zanix/*` package name, e.g. `'@zanix/auth'`. */
  name: string
  /** Every distinct resolved version found, each with the specifier(s) that resolved to it. */
  versions: { version: string; specifiers: string[] }[]
}

const ZANIX_JSR_SPECIFIER = /^jsr:(@zanix\/[a-z0-9-]+)@(.+)$/

/**
 * Finds every `@zanix/*` package a `deno.lock`'s `specifiers` map resolves to more than one
 * distinct version — a pure grouping pass, no I/O, over already-parsed lockfile data (see
 * `lockfile.ts` for reading it).
 *
 * Only `jsr:@zanix/*` specifiers are considered: the whole ecosystem publishes exclusively to
 * JSR, so an `npm:` specifier is never a `@zanix/*` drift, and a non-`@zanix` JSR package (`@std/
 * *`, third-party) is out of scope for this check — see `dependency-drift`/`ecosystem-maintenance`
 * for that.
 *
 * @param {Record<string, string>} specifiers - A `deno.lock`'s `specifiers` map, as returned by
 * `readLockfileSpecifiers`.
 * @returns {DuplicateFinding[]} One entry per `@zanix/*` package resolved to more than one
 * distinct version, sorted by package name. Empty when every `@zanix/*` package resolves to
 * exactly one version.
 *
 * @example
 * ```ts
 * findDuplicateZanixDeps({
 *   'jsr:@zanix/auth@~0.8.1': '0.8.1',
 *   'jsr:@zanix/auth@^1.0.0': '1.0.0',
 * })
 * // [{
 * //   name: '@zanix/auth',
 * //   versions: [
 * //     { version: '0.8.1', specifiers: ['jsr:@zanix/auth@~0.8.1'] },
 * //     { version: '1.0.0', specifiers: ['jsr:@zanix/auth@^1.0.0'] },
 * //   ],
 * // }]
 * ```
 */
export function findDuplicateZanixDeps(
  specifiers: Record<string, string>,
): DuplicateFinding[] {
  const byName = new Map<string, Map<string, string[]>>()

  for (const [specifier, version] of Object.entries(specifiers)) {
    const match = ZANIX_JSR_SPECIFIER.exec(specifier)
    if (!match) continue

    const [, name] = match
    const byVersion = byName.get(name) ?? new Map<string, string[]>()
    const specifierKeys = byVersion.get(version) ?? []

    specifierKeys.push(specifier)
    byVersion.set(version, specifierKeys)
    byName.set(name, byVersion)
  }

  const findings: DuplicateFinding[] = []

  for (const [name, byVersion] of byName) {
    if (byVersion.size <= 1) continue

    findings.push({
      name,
      versions: Array.from(byVersion, ([version, versionSpecifiers]) => ({
        version,
        specifiers: versionSpecifiers,
      })),
    })
  }

  return findings.sort((a, b) => a.name.localeCompare(b.name))
}
