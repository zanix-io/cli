import { toPascalCase } from '@zanix/helpers'

/**
 * Derives a reasonable PascalCase class-name prefix from a `@zanix/space` route path's own leaf
 * segment (e.g. `'products/[id]'` -> `'Id'`, `'products'` -> `'Products'`) — a starting point for
 * `zanix generate page`/`zanix generate layout`, not a naming authority; the generated file's
 * class/function name is meant to be adjusted by hand for a real route. Dynamic-segment brackets
 * (`[id]`) are stripped first — `toPascalCase` has no notion of them and would otherwise leave
 * `[`/`]` in the output, an invalid identifier character.
 */
export function pascalNameFromRoutePath(routePath: string): string {
  const segments = routePath.split('/').filter(Boolean)
  const leaf = segments[segments.length - 1] ?? 'index'
  return toPascalCase(leaf.replace(/^\[|\]$/g, ''))
}
