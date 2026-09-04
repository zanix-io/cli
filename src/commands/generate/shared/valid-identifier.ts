import type { Commander } from 'cli'

/** Matches a syntactically valid JS/TS identifier: starts with a letter, `_`, or `$`, followed by
 * any number of letters, digits, `_`, or `$`. Deliberately ASCII-only and deliberately not a
 * narrower "starts with a digit" special case — this is the actual shape the emitted
 * `export class <PascalName>`/`export function <pascalName>` etc. needs, so it also rejects a
 * PascalCase name that collapsed to the empty string (e.g. an all-punctuation `name` like `'---'`,
 * which `toPascalCase` reduces to `''`) or one that still contains a non-identifier character. */
const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Guards the PascalCase identifier every `<name>`-taking `zanix generate <artifact> <name>`
 * derives via `toPascalCase(name)` before it's emitted into generated source as a class/function/
 * type name. `assertSafeGeneratorName` only protects the raw `name` argument against path
 * traversal — it does nothing to stop a value like `'123entity'` (a leading digit survives
 * `toPascalCase`/`capitalize` untouched) or `'---'` (collapses to the empty string) from being
 * written straight into `export class 123Entity { ... }`-shaped invalid TypeScript with zero
 * warning. This is that missing check, routed through `cwd.throw` (Cliffy's
 * `throwErrors()`-configured error pipeline) so an invalid derived identifier surfaces as a clear
 * error + exit 1 — same convention `assertSafeGeneratorName` already uses.
 *
 * Call this immediately after each generator's own `const pascalName = toPascalCase(name)` line,
 * before `pascalName` is used for planning or any generated file content.
 *
 * @param cwd The command instance (`this` inside a generator action), used to route the failure
 * through Cliffy's own error pipeline via `cwd.throw`.
 * @param pascalName The PascalCase identifier derived from `name` via `toPascalCase`.
 * @param name The original, user-supplied `<name>` argument `pascalName` was derived from —
 * included in the error message because the user typed `name`, not `pascalName`.
 * @throws {Error} if `pascalName` isn't a valid JS/TS identifier (empty, starts with a digit,
 * or contains a character outside `[A-Za-z0-9_$]`).
 */
export function assertValidIdentifier(cwd: Commander, pascalName: string, name: string): void {
  if (!VALID_IDENTIFIER.test(pascalName)) {
    cwd.throw(
      new Error(
        `Invalid name "${name}" — it produces "${pascalName}", which isn't a valid TypeScript ` +
          `identifier. Use a name that starts with a letter (or "_"/"$") and contains only ` +
          `letters, digits, "_", or "$".`,
      ),
    )
  }
}
