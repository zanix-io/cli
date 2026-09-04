/** One top-level (module-scope) statement that executes something — a call, a `new`, a top-level
 * `await` — rather than just declaring one. `line` is 1-indexed, matching editor/stack-trace
 * convention. */
export type RiskyTopLevelStatement = {
  line: number
  /** Every identifier referenced anywhere inside this statement (excluding nested
   * function/class bodies, which don't run at module-evaluation time — see `analyze-file.ts`'s
   * own `walk()` doc for the one known gap this leaves: an immediately-invoked function expression's
   * body is not descended into, since no real instance of that shape exists in this ecosystem
   * today). */
  identifiers: string[]
}

/** One file's real analysis result: its risky top-level statements, and the local-name-to-import-
 * specifier map needed to tell whether a statement's referenced identifier came from another file
 * still inside the same cycle. */
export type FileAnalysis = {
  file: string
  riskyStatements: RiskyTopLevelStatement[]
  /** Local binding name -> the raw import specifier it came from (e.g. `SmtpClient -> './connector.ts'`,
   * or an aliased bare specifier like `'modules/logger/main.ts'` — this ecosystem uses both styles).
   * Every specifier is recorded here regardless of shape; whether it can actually be a same-repo
   * cycle member is decided downstream, by whether `graph.ts`'s `SpecifierResolutions` has a
   * same-repo resolution for it — a genuinely external specifier (another `@zanix/*` package,
   * `jsr:`, `npm:`, `https:`) simply has no entry there, not because it's excluded up front. */
  imports: Record<string, string>
}
