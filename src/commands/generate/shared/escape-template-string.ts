/**
 * Escapes a free-text value so it can be safely embedded as the content of a single-quoted
 * TypeScript string literal (`'${escapeTsStringLiteral(value)}'`) inside a generated `.ts` file.
 *
 * Every `zanix generate <artifact>` template that interpolates unvalidated user input (a CLI
 * flag/argument that isn't routed through `assertValidIdentifier`, e.g. `job`'s `--cron`,
 * `dlqprocessor`'s `--process-type`/`--schedule`, `subscriber`'s `--queue`, or `connector`'s
 * `--slot cache:<subtype>`) directly into a template-literal-built string is one `'` away from a
 * broken-out string literal: because generated files run at MODULE LOAD TIME the moment a real app
 * imports them (`registerCronJob`/`registerDLQProcessor`/`@Subscriber(...)`/`@Connector(...)` are
 * all top-level calls/decorators, not deferred), an unescaped `'` in the interpolated value doesn't
 * just corrupt the file — it can inject arbitrary statements that execute on import. This is the
 * fix: escape every character that would otherwise break out of, or otherwise be invalid inside, a
 * single-quoted JS/TS string literal, so the original value always round-trips back as inert string
 * content once re-embedded between `'...'`.
 *
 * Escapes, in order: `\` (must be first, or a later `\'`/`\n` this function inserts would itself be
 * re-escaped), `'` (the literal's own delimiter), and every raw JS `LineTerminator` character that's
 * illegal unescaped inside a (non-template) string literal — `\n`, `\r`, and the two Unicode
 * line/paragraph separators U+2028/U+2029 (all four are valid inside a *string* only when escaped;
 * a raw one is a syntax error, same as a raw newline).
 *
 * Deliberately NOT applied to `pascalName`-shaped values (class/type names) — those are already
 * constrained to a safe identifier by `assertValidIdentifier`, so escaping them would be redundant.
 * This is only for genuinely free-text values that end up inside a string literal, not an
 * identifier.
 *
 * @param value The raw, unvalidated string to embed inside a single-quoted TS string literal.
 * @returns `value` with every character that would break or corrupt the literal escaped.
 */
export function escapeTsStringLiteral(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029')
}

/**
 * Neutralizes the block-comment terminator inside a free-text value about to be embedded on a line
 * of a generated JSDoc-style block comment (e.g. `connector/cache.template.ts`'s `slot` in
 * `* Cache connector for X, registered under the '<slot>' core slot.`) — a DIFFERENT failure mode
 * from `escapeTsStringLiteral`'s, and one that function's quote-escaping does nothing to prevent: a
 * value containing an asterisk immediately followed by a slash closes the comment block early, and
 * everything after it (the rest of that JSDoc's own remaining lines, plus whatever code follows,
 * e.g. `cache.template.ts`'s own `@Connector({ slot: ... })` decorator line right below it) is then
 * parsed as live TypeScript rather than inert comment text — the same "executes on import" risk
 * `escapeTsStringLiteral` exists for, just triggered by a different two-character sequence.
 *
 * The fix is narrower than full escaping (a block comment has no escape syntax at all — nothing
 * turns the terminator into literal text the way `\'` does inside a string): every occurrence of
 * the terminator sequence in `value` gets a space inserted in the middle of it, which keeps the
 * visible doc text intact for a human reader while guaranteeing the exact two-character terminator
 * can never occur inside the embedded value.
 *
 * Only for the JSDoc-comment interpolation site specifically — the same `slot` value's OTHER
 * interpolation site (inside `@Connector({ slot: '<slot>' })`'s string literal) still needs
 * `escapeTsStringLiteral` instead; call both, once each, at their own respective interpolation
 * point.
 *
 * @param value The raw, unvalidated string to embed on a line inside a generated JSDoc comment.
 * @returns `value` with every block-comment-closing sequence broken up so it can't terminate the
 * comment it's embedded in.
 */
export function escapeJsDocCommentText(value: string): string {
  return value.replaceAll('*/', '* /')
}
