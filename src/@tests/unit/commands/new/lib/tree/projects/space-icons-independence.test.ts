import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { ensureSpaceScaffoldSideEffects } from 'commands/new/lib/tree/projects/space.ts'

/**
 * Proves `--icons` is genuinely independent of `--template`/preset — not just in the type
 * signature, but in actual behavior across every combination that exists today. `ensureSpace
 * ScaffoldSideEffects` never reads `preset` to decide whether to run the icon-catalog side
 * effect (see its own doc) — these tests exercise that claim directly, rather than trusting the
 * source comment.
 *
 * `@zanix/space-ui` is now a real, published JSR package with a real `ZANIX_DEPENDENCY_VERSIONS`
 * entry (see `space-icons.ts`'s own doc), so `icons: true` below reaches real success — a real
 * `assets/icons/` and `src/space/catalog-icon.ts` land on disk, no `logger.warn(..., 'noSave')`
 * graceful-degradation path involved (that path — `ensureSpaceScaffoldSideEffects` resolving
 * normally after `copyIconCatalog` itself rejects — still exists for a genuine network/fetch
 * failure; it's just no longer the deterministic outcome of every `icons: true` call the way it
 * was before this entry existed). The full real-network assertions for `icons: true` (this
 * function calls a real `fetch()` transitively via `copyIconCatalog`, which disqualifies it from
 * `unit/`) live in `functional/space-icons-live.test.ts` instead; this file keeps only the
 * `icons: false` cases,
 * which never touch the network. See "theme + icons" below for the `--theme default` + `--icons`
 * combination (`--theme default` also calls a real `fetch()` transitively via
 * `copyThemeAssets`, so those cases live in `functional/space-theme-live.test.ts`, not here).
 *
 * `assets/` itself is now created unconditionally (a `.gitkeep` placeholder, see
 * `ensureAssetsPlaceholder`'s own doc in `space.ts`) regardless of `--icons` — this file no longer
 * asserts it's ABSENT without `--icons`; it asserts the placeholder specifically, and that a real
 * `assets/icons/` never appears without `--icons` requested.
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

async function freshRoot(): Promise<string> {
  const root = `${temporaryFolder}/${crypto.randomUUID()}`
  await Deno.mkdir(root, { recursive: true })
  return root
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch {
    return false
  }
}

Deno.test(
  'no theme (base preset) + no icons: assets/ still exists (a .gitkeep placeholder), but no ' +
    'assets/icons/ ever lands without --icons',
  async () => {
    const root = await freshRoot()

    try {
      await ensureSpaceScaffoldSideEffects(root, 'base', false)

      assertEquals(await exists(join(root, 'assets', '.gitkeep')), true)
      assertEquals(await exists(join(root, 'assets', 'icons')), false)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  'template/base explicitly + no icons: identical to omitting --template — icons stays off, ' +
    'assets/ still gets its placeholder',
  async () => {
    const root = await freshRoot()

    try {
      await ensureSpaceScaffoldSideEffects(root, 'base', false)

      assertEquals(await exists(join(root, 'assets', '.gitkeep')), true)
      assertEquals(await exists(join(root, 'assets', 'icons')), false)
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

// `icons: true` cases (real success, and renderer-forwarding across both real fetched
// entrypoints) live in `functional/space-icons-live.test.ts` instead — `ensureSpaceScaffold
// SideEffects` calls a real `fetch()` transitively via `copyIconCatalog` once `icons: true`,
// which disqualifies it from `unit/` regardless of how contained it looks.

// ================================================================================================
// 'default' theme + icons — `--theme default` (`space-theme.ts`). Both `theme === 'default'` and
// `icons: true` call a real `fetch()` transitively (`copyThemeAssets`/`copyIconCatalog`), which
// disqualifies THIS combination from `unit/` per `zanix-test-tier-conventions`'s Pattern B — the
// real, unmocked assertion proving `globalCss` and `assetsDir` both land independently lives in
// `functional/space-theme-live.test.ts` instead, right alongside its own `--icons`-only and
// `--theme default`-only cases. Nothing left to track here as `.ignore`d.
// ================================================================================================
