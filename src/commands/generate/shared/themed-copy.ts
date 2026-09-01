import type { ThemeName } from 'commands/new/lib/tree/themes.ts'

/**
 * Resolves theme-specific generator content, falling back to a default when the project's theme
 * has no entry in `table` — covers `'default'`, no theme installed at all, and any future theme
 * not yet given its own entry. The shared pattern `errorTemplate`/`notFoundTemplate` (`generate/
 * error/template.ts`, `generate/not-found/template.ts`) both use for their fallback copy: adding
 * theme-specific content for a new theme is a one-line addition to that theme's own `table` entry,
 * never a new branch in either template function.
 */
export function resolveThemedCopy<T>(
  theme: ThemeName | undefined,
  table: Partial<Record<ThemeName, T>>,
  fallback: T,
): T {
  return (theme && table[theme]) ?? fallback
}
