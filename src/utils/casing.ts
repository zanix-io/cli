/**
 * Converts a string (camelCase, PascalCase, snake_case, spaced, or already kebab-case) into
 * kebab-case, matching the folder-naming convention used across Zanix project scaffolding
 * (e.g. `grant-access`, `netting-opportunities`).
 */
export function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/**
 * Converts a string (kebab-case, snake_case, spaced, or camelCase) into PascalCase, matching the
 * class-naming convention used across Zanix generated code (e.g. `grant-access` -> `GrantAccess`).
 */
export function toPascalCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}
