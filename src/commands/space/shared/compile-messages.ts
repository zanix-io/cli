import { parse } from '@formatjs/icu-messageformat-parser'
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser'

/**
 * `messages/*.json` → `MessageFormatElement[]` — this package's own ICU→AST compiler, the
 * build-time half of `@zanix/space`'s i18n story. `@zanix/space` itself never imports this module
 * (or `@formatjs/icu-messageformat-parser` at all) — `loadMessages()` there stays completely
 * opaque to ICU/AST, only ever resolving/merging catalogs as plain JSON. This module's own output
 * is meant to be handed to `@zanix/space-ui`'s `createFormatter`/`IntlProvider`, the one place that
 * actually understands what a `MessageFormatElement[]` means.
 *
 * Deliberately narrow: this compiles catalogs, nothing else. No `@formatjs/intl` dependency here —
 * the CLI compiles, `space-ui` consumes; owning both would blur a boundary that's meant to stay
 * sharp. No `buildHash`-style id namespacing, no `.lazy` tier, no `formatData`/`formatContent` — see
 * `@zanix/space`'s own CHANGELOG for why those stay unported from the legacy component this
 * replaces.
 *
 * **Only `zanix space build` calls {@linkcode writeCompiledMessagesTree}. `zanix space dev` never
 * does, and that's not a gap.** `loadMessages()` already bypasses its own cache entirely under
 * `znx space dev` (`isDevClientEnabled()`), re-reading the raw source file on every request — and
 * `@zanix/space-ui`'s `createFormatter` already accepts a raw ICU string exactly as it accepts an
 * AST (verified by that package's own test suite). So a dev-time edit to
 * `messages/es/index.json` is already reflected on the very next request, with zero compilation
 * involved anywhere in dev — the SAME live-edit story `assetsDir` and `loadMessages()`'s own dev
 * bypass already give every other Space dev-time behavior. Running the compiler in dev would only
 * add a step that overwrites a developer's own hand-authored, human-readable ICU source with AST
 * while they're actively editing it — a real regression, not a nicety — for a scenario
 * (dev-mode formatting) that already works correctly without it.
 *
 * @module
 */

/**
 * One source catalog, as read from a `.json` file under a `messagesDir` — a flat,
 * namespaced-string-key object. A value may already be a precompiled AST (left over from a
 * previous run, or hand-provided) or a not-yet-compiled ICU string — {@linkcode compileCatalog}'s
 * own doc covers how each is handled.
 */
export type SourceCatalog = Record<string, string | MessageFormatElement[]>

/** One fully compiled catalog — every value is AST. Directly consumable by `@zanix/space-ui`'s own
 * `createFormatter`/`IntlProvider`: the exact `MessageFormatElement[]` shape
 * `intl-messageformat`'s own `IntlMessageFormat` constructor accepts natively, no transformation
 * needed at the consuming end (verified by a dedicated test that feeds this compiler's real output
 * straight into `createFormatter`). */
export type CompiledCatalog = Record<string, MessageFormatElement[]>

/**
 * Thrown by {@linkcode compileCatalog} — names the exact key whose ICU source failed to parse,
 * alongside the underlying FormatJS parser error, so a build failure points at the actual broken
 * message instead of a bare "compilation failed" with no further detail.
 */
export class MessageCompileError extends Error {
  /** The catalog key whose value failed to parse. */
  public readonly key: string

  constructor(key: string, cause: unknown) {
    super(`Invalid ICU syntax for message '${key}': ${describeParserError(cause)}`, { cause })
    this.name = 'MessageCompileError'
    this.key = key
  }
}

function describeParserError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * Compiles one catalog's ICU string values into AST — the one piece of actual ICU parsing in this
 * package, using `@formatjs/icu-messageformat-parser`'s own `parse()` directly, never
 * reimplemented. Returns a NEW object; `source` is never mutated.
 *
 * A value that is already an array (a precompiled AST — left over from a previous run, or
 * hand-provided) is passed through completely unchanged, never re-parsed or re-validated. That
 * makes this function idempotent (compiling an already-fully-compiled catalog is a no-op) and lets
 * a source catalog legitimately mix already-compiled and not-yet-compiled values across keys —
 * `@zanix/space-ui`'s own `createFormatter` already accepts exactly this mixed shape (see that
 * package's own CHANGELOG).
 *
 * **Fail-fast per catalog, on purpose.** The first key with invalid ICU syntax throws immediately —
 * this function never returns a catalog with some keys compiled and the invalid one silently
 * skipped or left as raw source text pretending to be compiled output. A partially-compiled catalog
 * is strictly worse than a build that stops: nothing downstream can tell "this value was
 * deliberately never compiled" apart from "this value failed to compile and got left behind by
 * mistake" once mixed catalogs are a normal, supported state. See {@linkcode compileMessagesTree}'s
 * own doc for how this composes across MULTIPLE catalogs/files, where isolation — not fail-fast —
 * is the right default instead.
 *
 * @throws {MessageCompileError} for the first key whose value fails to parse.
 */
export function compileCatalog(source: SourceCatalog): CompiledCatalog {
  const compiled: CompiledCatalog = {}
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      compiled[key] = value
      continue
    }
    try {
      compiled[key] = parse(value)
    } catch (error) {
      throw new MessageCompileError(key, error)
    }
  }
  return compiled
}

/** Every `.json` file under `dir`, recursive — mirrors `@zanix/space`'s own `loadMessages()`
 * convention of a `messagesDir` tree (`{lang}/index.json`, `{lang}/populations/{population}.json`)
 * without hardcoding that exact shape, the same way the legacy component's own compiler scanned
 * every `.json` file under its own `intl/` root rather than special-casing each known filename. */
async function collectJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const subdirs: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory) {
      subdirs.push(path)
    } else if (entry.isFile && entry.name.endsWith('.json')) {
      files.push(path)
    }
  }
  const nested = await Promise.all(subdirs.map(collectJsonFiles))
  return [...files, ...nested.flat()]
}

async function readSourceCatalog(path: string): Promise<SourceCatalog> {
  const raw = await Deno.readTextFile(path)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Malformed JSON: ${(error as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Expected a flat JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`,
    )
  }
  return parsed as SourceCatalog
}

/** One catalog file that failed to compile — either malformed JSON/shape, or a
 * {@linkcode MessageCompileError} from {@linkcode compileCatalog} (in which case `error.key`
 * identifies the exact broken message). */
export interface CompileFailure {
  path: string
  error: Error
}

/**
 * The result of {@linkcode compileMessagesTree}: every catalog that compiled cleanly, keyed by its
 * source file path, and every one that didn't. **`compiled` is never a partial view of a failed
 * file** — `compileCatalog`'s own fail-fast contract means a path only ever appears in exactly one
 * of the two, never both, and never as a partially-populated entry in `compiled`.
 *
 * A non-empty `failures` MUST be treated as a fatal build error by any caller — never write
 * `compiled` to disk while silently discarding `failures`, which would produce an output tree that
 * looks complete but is actually missing whatever broke. {@linkcode assertNoCompileFailures} is the
 * one-call way to enforce that.
 */
export interface CompileTreeResult {
  compiled: Record<string, CompiledCatalog>
  failures: CompileFailure[]
}

/**
 * Compiles every `.json` message catalog found under `dirs` (a single directory or, mirroring
 * `defineSpaceApp({ messagesDir })`'s own `string | string[]`, several) — the tree-level half of
 * this module's own compiler, layered directly on {@linkcode compileCatalog}.
 *
 * **Isolated across files, on purpose — the opposite default from `compileCatalog`'s own
 * fail-fast.** One catalog with a broken message does not stop the others in the same run from
 * compiling: every file is attempted independently and concurrently, so a single `zanix` invocation
 * surfaces every problem in the tree at once instead of a fix-one-rerun-repeat loop. This is
 * "isolation between catalogs/files", never "silent partial compilation within one catalog" —
 * `compileCatalog`'s own fail-fast still applies per file; this function only decides how failures
 * across DIFFERENT files relate to each other.
 *
 * This function itself never throws for a compile failure (a missing `dirs` root is the one
 * exception — that is a caller configuration error, not a catalog problem) and never writes
 * anything to disk — it is a pure read-and-compile step. Deciding what "failed" means for a real
 * build (abort entirely, per {@linkcode assertNoCompileFailures}) is deliberately left to whatever
 * wires this into `zanix space build`/`dev`, not baked in here.
 */
export async function compileMessagesTree(dirs: string | string[]): Promise<CompileTreeResult> {
  const roots = Array.isArray(dirs) ? dirs : [dirs]
  const filesPerRoot = await Promise.all(roots.map(collectJsonFiles))
  const paths = filesPerRoot.flat()

  const compiled: Record<string, CompiledCatalog> = {}
  const failures: CompileFailure[] = []

  await Promise.all(
    paths.map(async (path) => {
      try {
        const source = await readSourceCatalog(path)
        compiled[path] = compileCatalog(source)
      } catch (error) {
        failures.push({ path, error: error instanceof Error ? error : new Error(String(error)) })
      }
    }),
  )

  return { compiled, failures }
}

/**
 * Turns a non-empty `result.failures` into one aggregate, thrown `Error` naming every failed file
 * and its reason — the one-call hook a future `zanix space build`/`dev` step uses to turn "some
 * catalogs failed" into a hard build failure, without hand-rolling the aggregation itself.
 * `compileMessagesTree` never calls this on its own — it reports facts; this decides what to do
 * about them. A no-op when `result.failures` is empty.
 */
export function assertNoCompileFailures(result: CompileTreeResult): void {
  if (result.failures.length === 0) return
  const summary = result.failures.map(({ path, error }) => `  - ${path}: ${error.message}`).join(
    '\n',
  )
  throw new Error(
    `${result.failures.length} message catalog(s) failed to compile:\n${summary}`,
  )
}

/**
 * Compiles every catalog under `dirs` and writes each one back to the EXACT source path it was
 * read from — in place, same filename, same `messagesDir` a project's `space.app.ts` already
 * declares. `@zanix/space`'s own `loadMessages()` never learns anything happened: it reads the
 * same path either way, and never inspects a value's shape (string vs. AST) — the file just
 * contains different JSON after this runs.
 *
 * This is the one function `zanix space build` calls — never `compileMessagesTree` +
 * `assertNoCompileFailures` + a hand-rolled write loop duplicated at the call site. Fails hard
 * (via `assertNoCompileFailures`) before writing anything: a compile failure anywhere in the tree
 * means NOTHING gets written, not a partial tree with some catalogs updated and others silently
 * left on old (or broken) content.
 *
 * **In-place, on purpose — intended for a CI/deploy build, never a developer's live working
 * copy.** Compiling is idempotent (`compileCatalog`'s own doc — an already-compiled value passes
 * through unchanged), so running this against an already-compiled tree, or running it twice in the
 * same pipeline, is safe and a no-op the second time. `zanix space dev` never calls this — see
 * this module's own doc for why dev mode needs no compilation step at all.
 *
 * @returns Every source path that was (re)written, for a caller that wants to log what changed.
 */
export async function writeCompiledMessagesTree(dirs: string | string[]): Promise<string[]> {
  const result = await compileMessagesTree(dirs)
  assertNoCompileFailures(result)

  const paths = Object.keys(result.compiled)
  await Promise.all(
    paths.map((path) => Deno.writeTextFile(path, JSON.stringify(result.compiled[path]))),
  )
  return paths
}
