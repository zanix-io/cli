import { ensureZanixDependency, ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'
import { getSpaceUiEntry, type RendererName } from 'commands/new/lib/renderer.ts'
import { join } from '@std/path'

/**
 * `--icons`' own scaffold side effect — copies `@zanix/space-ui`'s curated default icon catalog
 * (`src/templates/shared/icons/{catalog.svg,NOTICE.md,LICENSES/...}`) into a generated project's
 * own `assets/icons/`, as a plain file the project owns outright — never a runtime dependency, and
 * never coupled to `--template`/the visual theme (see the Styling Proposal's Fase 3: the catalog
 * is `shared/`, not `theme/` — any theme, or none, can reuse the exact same `catalog.svg`).
 *
 * `CatalogIcon` (`@zanix/space-ui`) never imports or resolves this file itself — it stays exactly
 * as approved (`href`/`name` in, `Icon` untouched) — a generated project supplies whatever `href`
 * this scaffold's own output resolves to (e.g. `/assets/icons/catalog.svg`, or a hashed
 * `resolveAssetHref('icons/catalog.svg')` if the project later builds).
 *
 * @module
 */

/**
 * Exported (not private) so a test can assert this matches exactly what `@zanix/space-ui` itself
 * ships at `src/templates/shared/icons/` — without re-implementing that package's own
 * `catalog-integrity.test.ts` (17 symbols ↔ `CatalogIconName`, viewBox-per-symbol, no brand
 * icons, ...). This side just needs to know WHICH files to fetch/copy, not validate their
 * contents — `space-ui`'s own suite already owns that.
 */
export const ICON_TEMPLATE_FILES = [
  'catalog.svg',
  'NOTICE.md',
  'LICENSES/fontawesome-free-7.3.1.txt',
]

/**
 * Resolves the exact JSR version to fetch `@zanix/space-ui`'s scaffold templates from —
 * `ZANIX_DEPENDENCY_VERSIONS` ONLY, never a live "latest" Shields.io lookup (see the Styling
 * Proposal's Fase 3 investigation for why: that mechanism isn't pinned to anything — the exact
 * same `cli` binary run twice, unchanged, could fetch different template content if the source
 * package published a new version in between).
 *
 * `@zanix/space-ui` is a real, published JSR package as of `0.1.0`, with a real entry in
 * `ZANIX_DEPENDENCY_VERSIONS` — `--icons` resolves and fetches its real scaffold templates. The
 * lookup stays typed against a key that COULD be absent (`Partial`, not a direct property access),
 * and still throws rather than silently falling back to anything dynamic (a live lookup, a
 * hardcoded guess) if that entry were ever removed — a real, explicit gate, not a bug — so a future
 * accidental removal of the entry fails loudly instead of resolving to `undefined`/`NaN` deep
 * inside a fetch URL.
 */
export function resolveSpaceUiVersion(): string {
  const spec =
    (ZANIX_DEPENDENCY_VERSIONS as Partial<Record<'@zanix/space-ui', string>>)['@zanix/space-ui']

  if (!spec) {
    throw new Error(
      "@zanix/space-ui has no ZANIX_DEPENDENCY_VERSIONS entry — 'ZANIX_DEPENDENCY_VERSIONS' must " +
        "declare it (see cli/deno.jsonc's own '@zanix/space-ui' import). --icons can't fetch a " +
        'real icon catalog without it. This is a deliberate gate, not a bug — never falls back to ' +
        "a live 'latest' lookup. See @zanix/space-ui's Styling Proposal (Fase 3) for the full " +
        'reasoning.',
    )
  }

  const version = spec.match(/@\^?([\d.]+)$/)?.[1]
  if (!version) {
    throw new Error(
      `Could not parse a semver out of ZANIX_DEPENDENCY_VERSIONS['@zanix/space-ui']: "${spec}"`,
    )
  }
  return version
}

/**
 * Fetches one file's raw content from `@zanix/space-ui`'s own `src/templates/shared/icons/` at
 * the resolved version — same `readFileFromCurrentUrl` machinery `getZanixTemplateContent` uses
 * for every other JSR-fetched scaffold template, called here with an already-resolved version so
 * this NEVER goes through a live "latest" lookup path, not even indirectly.
 *
 * `{current}` is a dummy trailing path segment, not a real one — same convention `templates.ts`'s
 * own `getZanixTemplateContent` already uses: `readFileFromCurrentUrl`'s first argument is always
 * resolved via `join(callerUrl, '..', relativePath)` (`getPathFromCurrent`'s real contract — it
 * strips the LAST segment off its first argument, then appends its second), so the base URL needs
 * some placeholder final segment for that strip to land on. Passing an already-complete URL (with
 * `relativePath` baked into it) as the first argument and `''` as the second — this function's own
 * previous shape — silently strips the real filename instead of the placeholder, always resolving
 * to the CONTAINING DIRECTORY's URL, never the file itself (confirmed: this 404s against the real,
 * published `@zanix/space-ui`, empirically, not just in theory).
 *
 * Exported standalone (not folded into {@linkcode copyIconCatalog}) so the fetch-a-file half and
 * the write-it-to-disk half can be tested independently — the write half needs no JSR access at
 * all and is fully testable today; only this half needs the network.
 */
export async function getSpaceUiIconTemplate(relativePath: string): Promise<string> {
  const version = resolveSpaceUiVersion()
  const url = `https://jsr.io/@zanix/space-ui/${version}/src/templates/shared/icons/{current}`
  return await readFileFromCurrentUrl(url, relativePath)
}

/**
 * Writes already-resolved icon-catalog file contents to `${root}/assets/icons/...`, preserving
 * the exact same relative layout `@zanix/space-ui` itself uses (`catalog.svg`, `NOTICE.md`,
 * `LICENSES/fontawesome-free-7.3.1.txt`) — never renamed, never merged, never minimized. Takes
 * already-fetched content rather than fetching itself, so this half of the side effect (the part
 * that needs no JSR access) is testable today, independent of the publish gate in
 * {@linkcode resolveSpaceUiVersion}.
 */
export async function writeIconCatalogFiles(
  root: string,
  contents: Record<string, string>,
): Promise<void> {
  const targetDir = join(root, 'assets', 'icons')
  await Deno.mkdir(join(targetDir, 'LICENSES'), { recursive: true })

  await Promise.all(ICON_TEMPLATE_FILES.map((relativePath) => {
    const content = contents[relativePath]
    if (content === undefined) {
      throw new Error(`writeIconCatalogFiles: missing content for "${relativePath}"`)
    }
    return Deno.writeTextFile(join(targetDir, relativePath), content)
  }))
}

/**
 * The generated project's own `CatalogIcon` — `@zanix/space-ui`'s real `CatalogIcon`, pre-wired to
 * THIS project's real, hashed `icons/catalog.svg` build URL via `@zanix/space`'s own
 * `resolveAssetHref`. This is the ONE place that knowledge lives: `@zanix/space-ui` itself never
 * learns this file exists, where it's served from, or what its hashed name becomes (see this
 * module's own doc — `CatalogIcon` keeps requiring `href` explicitly, on purpose, unchanged); a
 * generated project's own scaffold is exactly the layer that already knows all three things
 * (it wrote the file, at this exact relative path, for a project that already depends on
 * `@zanix/space`) — so the composition belongs here, not as an optional/guessed `href` inside
 * `space-ui`.
 *
 * `renderer` picks the matching entrypoint (`@zanix/space-ui` for React, `@zanix/space-ui/preact`
 * for Preact) — same convention {@linkcode getSpaceAppTemplate} already establishes for
 * `@zanix/space/react` vs `@zanix/space/preact`. The generated API is IDENTICAL either way — only
 * the two import specifiers differ; a consumer never needs to know which renderer produced this
 * file to use it.
 *
 * A plain function (`props => BaseCatalogIcon({ ...props, href })`), not a second component
 * factory — `CatalogIcon` (`@zanix/space-ui`) is already a fully-bound, renderer-specific export;
 * there is nothing left here to parametrize by renderer beyond which one to import from.
 *
 * The generated wrapper's own JSDoc below warns against Comet usage: `resolveAssetHref`
 * (`@zanix/space/assets-manifest`) is marked `'server-only'` (that package's own directive-
 * prologue convention, enforced by `cometPlugin`) — a `'use comet'` file that imports this wrapper,
 * directly or transitively, fails the build with a real, named "Server-only module imported into
 * client Comet" error, not a silent runtime bug. Confirmed live: a project using `CatalogIcon`
 * from inside a Comet gets that exact error, naming the real import chain.
 */
export const getCatalogIconWrapperTemplate = (renderer?: RendererName): string => {
  const entry = getSpaceUiEntry(renderer)

  return `import { CatalogIcon as BaseCatalogIcon } from '${entry}'
import type { CatalogIconProps } from '${entry}'
import { resolveAssetHref } from '@zanix/space/assets-manifest'

/**
 * This project's own default icon catalog, pre-wired to its real, hashed build URL — the
 * counterpart to \`@zanix/space-ui\`'s own \`CatalogIcon\`, minus \`href\` (resolved here instead:
 * only this project knows its own \`assetsDir\` layout and hashing).
 *
 * Use this from a page/layout only — never from inside a \`'use comet'\` file. \`resolveAssetHref\`
 * (\`@zanix/space/assets-manifest\`) is server-only; a Comet ships to the browser, so importing this
 * wrapper from one fails the build with a "Server-only module imported into client Comet" error.
 * If a Comet genuinely needs this icon, resolve the href in the page that renders it and pass the
 * resulting STRING down as a prop instead.
 */
export function CatalogIcon(props: Omit<CatalogIconProps, 'href'>) {
  return BaseCatalogIcon({ ...props, href: resolveAssetHref('icons/catalog.svg') })
}
`
}

/**
 * Where {@linkcode getCatalogIconWrapperTemplate}'s own output is written — alongside `routes/`/
 * `comets/`, under this project's own `src/space/` (the same "your app's own source code, owned
 * outright, editable freely" home {@linkcode getSpaceSrcTree} already establishes for those two),
 * never inside `assets/icons/` itself (that directory is scanned wholesale by `assetsDir`/
 * `assetsPlugin` — dropping a `.ts` file in there would make it a scanned/hashed "asset" by
 * accident) and never at the project root (reserved for `mod.ts`/`space.app.ts`, not app code).
 */
export async function writeCatalogIconWrapper(
  root: string,
  renderer?: RendererName,
): Promise<void> {
  const targetDir = join(root, 'src', 'space')
  await Deno.mkdir(targetDir, { recursive: true })
  await Deno.writeTextFile(
    join(targetDir, 'catalog-icon.ts'),
    getCatalogIconWrapperTemplate(renderer),
  )
}

/**
 * Declares `@zanix/space-ui` in the generated project's own `deno.json` — the real dependency
 * {@linkcode getCatalogIconWrapperTemplate}'s output imports (`@zanix/space-ui` for React,
 * `@zanix/space-ui/preact` for Preact — one bare-package import-map entry covers both subpaths
 * automatically: confirmed empirically against the real published package that `deno check`
 * resolves `@zanix/space-ui/preact` from a plain `"@zanix/space-ui": "jsr:@zanix/space-ui@^0.1.0"`
 * entry with no separate subpath key needed, unlike `@zanix/app/runtime`'s own dedicated entry),
 * via {@linkcode ensureZanixDependency} — the same mechanism every `zanix generate` leaf already
 * uses for its own on-demand dependency.
 *
 * Deliberately NOT called from {@linkcode copyIconCatalog} itself, nor from
 * `ensureSpaceScaffoldSideEffects`: both run BEFORE `zanix new`'s own `saveZanixConfig` ever
 * writes a `deno.json` to disk at all (see `newSpaceAction`/`newSpacecraftAction`'s own doc for
 * the exact sequencing) — `ensureZanixDependency` reads/writes that file directly and silently
 * no-ops when it doesn't exist yet (its own, correct behavior for `zanix generate`, which only
 * ever runs against an already-scaffolded project). Calling it that early would silently produce
 * a generated `catalog-icon.ts` with no matching `deno.json` import — the empirically-confirmed
 * gap this function exists to close (`deno check` on a fresh `--icons` scaffold failed to resolve
 * the bare `@zanix/space-ui` specifier). Call this AFTER `saveZanixConfig`, and only once the icon
 * catalog itself actually landed on disk — `newSpaceAction`/`newSpacecraftAction` gate this on
 * `ensureSpaceScaffoldSideEffects`'s own return value, never on the raw `--icons` flag alone
 * (a real network/fetch failure already degrades `--icons` gracefully; declaring this dependency
 * on that same failed attempt would leave `deno.json` naming a package the project doesn't
 * actually import anywhere).
 */
export async function ensureSpaceUiDependency(root: string): Promise<void> {
  await ensureZanixDependency(root, '@zanix/space-ui')
}

/**
 * Best-effort removal of exactly the two paths {@linkcode copyIconCatalog} itself ever writes —
 * `${root}/assets/icons/` (via `writeIconCatalogFiles`) and `${root}/src/space/catalog-icon.ts`
 * (via `writeCatalogIconWrapper`) — nothing else. Called only from `copyIconCatalog`'s own catch,
 * right before it rethrows: `writeIconCatalogFiles`' 3 concurrent `Deno.writeTextFile` calls
 * (`Promise.all`) can leave a subset of `catalog.svg`/`NOTICE.md`/`LICENSES/...` written if one
 * rejects while the others already succeeded, and a `writeCatalogIconWrapper` failure AFTER
 * `writeIconCatalogFiles` already succeeded would otherwise leave a fully-written `assets/icons/`
 * with no matching `catalog-icon.ts`. Either shape is a confusing half-written catalog a fresh
 * `zanix new space --icons` retry couldn't cleanly distinguish from a real one — this guarantees
 * the catalog is always either fully present or fully absent after a failed `copyIconCatalog`.
 * `Promise.allSettled`, not `Promise.all`: a cleanup failure (e.g. a permission error on `remove`
 * itself) must never mask or replace the real underlying error `copyIconCatalog` is about to
 * rethrow — this is tidying, not the operation that matters. A `Deno.errors.NotFound` (the common
 * case: the gate throws before anything was ever written) is expected and silently ignored, same
 * as any other cleanup outcome.
 */
async function cleanupIconCatalogOutput(root: string): Promise<void> {
  await Promise.allSettled([
    Deno.remove(join(root, 'assets', 'icons'), { recursive: true }),
    Deno.remove(join(root, 'src', 'space', 'catalog-icon.ts')),
  ])
}

/**
 * The full `--icons` side effect: fetches every file in {@linkcode ICON_TEMPLATE_FILES} from the
 * resolved `@zanix/space-ui` version, writes them via {@linkcode writeIconCatalogFiles}, then
 * writes this project's own {@linkcode writeCatalogIconWrapper}. Runs strictly independent of
 * `--template`/preset — nothing here reads `preset` at all, by design (see this module's own doc:
 * the icon catalog is `shared/`, never `theme/`).
 *
 * Still throws on any failure — this function's own contract, unchanged (its caller,
 * `ensureSpaceScaffoldSideEffects`, is what decides to catch and degrade gracefully instead of
 * propagating further; see its own doc). On failure, first runs
 * {@linkcode cleanupIconCatalogOutput} to remove any of its OWN partial output, then rethrows the
 * original error completely unchanged (never wrapped, never replaced) — a caller catching this
 * still sees the real, specific underlying message (e.g. `resolveSpaceUiVersion`'s own gate
 * message, or a real network/fetch/write error).
 */
export async function copyIconCatalog(root: string, renderer?: RendererName): Promise<void> {
  try {
    const entries = await Promise.all(
      ICON_TEMPLATE_FILES.map(
        async (relativePath) => [relativePath, await getSpaceUiIconTemplate(relativePath)] as const,
      ),
    )
    await writeIconCatalogFiles(root, Object.fromEntries(entries))
    await writeCatalogIconWrapper(root, renderer)
  } catch (error) {
    await cleanupIconCatalogOutput(root)
    throw error
  }
}
