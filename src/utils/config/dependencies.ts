import type { ZanixProjects } from '@zanix/types'

import { getConfigDir, readConfig, saveConfig } from '@zanix/helpers'

/**
 * The single source of truth for which import specifier `cli` writes for each Zanix package it can
 * declare in a generated project's `deno.json`. Bumping a compatible version for any Zanix
 * dependency means editing exactly one line here — nothing else in `cli` (templates, generators,
 * `zanix new`/`zanix generate`) hardcodes a version of its own.
 *
 * `@zanix/validator` isn't a published package — every sibling Zanix repo (`server`, `datamaster`,
 * `auth`, `core`, `admin`) declares it as an import alias into `@zanix/utils`'s own `/validator`
 * subpath; the value here follows that same, already-established convention.
 *
 * `@zanix/app`/`@zanix/space` aren't published on JSR yet (the `app`/`space` project-type split is
 * still mid-migration — see `cli/deno.jsonc`'s own `TEMP` override). Declaring them here is still
 * correct — this is what `deno.json` SHOULD say once they're published — but `deno check`/`deno add`
 * against a freshly generated `app`/`space` project will fail until that publish happens; that's a
 * publishing gap outside `cli`'s control, not a bug in this table.
 */
export const ZANIX_DEPENDENCY_VERSIONS = {
  '@zanix/server': 'jsr:@zanix/server@^3.1.0',
  '@zanix/datamaster': 'jsr:@zanix/datamaster@^1.2.0',
  '@zanix/asyncmq': 'jsr:@zanix/asyncmq@^0.5.0',
  '@zanix/validator': 'jsr:@zanix/utils@2.*/validator',
  // Same alias convention as `@zanix/validator` above — `IsObjectID.ts`/`IsPermission.ts` (see
  // `rto/renderer.ts`) import `type { ValidationOptions } from '@zanix/types'`, verified live via
  // `deno check` against a freshly generated `server` scaffold.
  '@zanix/types': 'jsr:@zanix/utils@2.*/types',
  '@zanix/core': 'jsr:@zanix/core@^1.0.0',
  '@zanix/app': 'jsr:@zanix/app@^0.1.0',
  // A separate import-map key, not covered by the bare '@zanix/app' entry above — same convention
  // '@zanix/validator' already uses for a subpath of a different package. A pure `space` project's
  // entrypoint imports `activateApps` from here directly (never `@zanix/core`, see
  // `getSpaceModTemplate`'s own doc in `cli`), so this needs its own declared specifier.
  '@zanix/app/runtime': 'jsr:@zanix/app@^0.1.0/runtime',
  '@zanix/space': 'jsr:@zanix/space@^0.1.0',
} as const satisfies Record<string, string>

/**
 * Same single-source-of-truth reasoning as `ZANIX_DEPENDENCY_VERSIONS`, kept as its own table for
 * every non-`@zanix/*` (npm/jsr third-party) version `cli` ever writes into a generated project's
 * `deno.json` — a version like `react`'s below is exactly as easy to let drift as a `@zanix/*` one
 * if it's left inline at its call site instead of centralized here.
 */
export const THIRD_PARTY_DEPENDENCY_VERSIONS = {
  // `base.ts` writes this for `space`/`space-server` — `jsxImportSource: 'react'` means every
  // `.tsx` file has an implicit `react/jsx-runtime` import. Same version `@zanix/space`'s own
  // `deno.json` pins.
  react: 'npm:react@^19.2.0',
} as const satisfies Record<string, string>

type ZanixDependency = keyof typeof ZANIX_DEPENDENCY_VERSIONS

/**
 * Every `@zanix/*` package a freshly scaffolded project of this type actually imports — verified
 * against the real generator/template output, not assumed. `library` gets none: its placeholder
 * `mod.ts` is fetched from `@zanix/utils`'s own templates and imports nothing `@zanix/*`.
 */
export const PROJECT_TYPE_DEPENDENCIES: Record<ZanixProjects, ZanixDependency[]> = {
  library: [],
  app: ['@zanix/app'],
  // `mod.ts` (see `getSpaceModTemplate`) imports `activateApps` from `@zanix/app/runtime` and
  // `bootstrapServers` from `@zanix/server` directly — never `@zanix/core` (a pure frontend project
  // has no reason to depend on its backend-aggregator tier).
  space: ['@zanix/space', '@zanix/app/runtime', '@zanix/server'],
  server: [
    '@zanix/server',
    '@zanix/datamaster',
    '@zanix/asyncmq',
    '@zanix/validator',
    '@zanix/types',
    '@zanix/core',
  ],
  'space-server': [
    '@zanix/space',
    '@zanix/server',
    '@zanix/datamaster',
    '@zanix/asyncmq',
    '@zanix/validator',
    '@zanix/types',
    '@zanix/core',
  ],
}

/**
 * For `zanix generate` on an already-scaffolded project: adds `pkg`'s import to `deno.json` if it's
 * not declared yet, resolving the version from `ZANIX_DEPENDENCY_VERSIONS` — the same table
 * `zanix new` reads from, so a generator's declared dependency never drifts from what a fresh
 * scaffold of the same type would have written. Never overrides an existing entry, same
 * never-clobber guarantee as `ensureConstant` — a version the project owner already pinned by hand
 * is left alone.
 */
export async function ensureZanixDependency(
  root: string | undefined,
  pkg: ZanixDependency,
): Promise<void> {
  const configPath = getConfigDir(root)
  if (!configPath) return

  const config = readConfig(configPath)
  if (config.imports?.[pkg]) return

  config.imports = { ...config.imports, [pkg]: ZANIX_DEPENDENCY_VERSIONS[pkg] }
  await saveConfig(config, configPath)
}
