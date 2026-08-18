/**
 * Matches a 24-character hex MongoDB ObjectId string.
 *
 * Not imported anywhere in this package's own runtime today — every real reference to
 * `OBJECTID_REGEX` (`rto/renderer.ts`'s `isObjectIdTemplate`) is a SEPARATE, hand-typed string
 * literal (`OBJECTID_REGEX_CONSTANT`) describing the same-named constant this generator writes
 * into a freshly generated project's own `src/utils/constants.ts` (a different file, in the
 * consumer's own project) — not an import of, or derived from, this one. The two currently match
 * by hand only; nothing enforces they stay in sync if either is edited (see
 * `OBJECTID_REGEX_CONSTANT`'s own doc in `rto/renderer.ts`).
 */
export const OBJECTID_REGEX = /^[0-9a-fA-F]{24}$/
