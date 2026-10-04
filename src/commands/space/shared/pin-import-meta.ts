import { fromFileUrl } from '@std/path'
import { init as esModuleLexerInit, parse as parseEsModule } from 'es-module-lexer'

// Idempotent: `importProjectModule` already awaits the same one-time WASM initialization.
await esModuleLexerInit

/** Matches the property access that follows an `import.meta` the lexer found. */
const IMPORT_META_PROPERTY_RE = /^\s*\.\s*(url|filename)\b/

/**
 * Makes a rewritten temporary copy of a module report where the ORIGINAL file lives.
 *
 * `importProjectModule` rewrites a project's local file into a temporary sibling
 * (`.zanix-import-<uuid>.js`, written next to the original) so its bare specifiers resolve against the
 * project's own configuration. Inside that copy `import.meta.url` is the copy's own address, and
 * anything that records it records the throwaway file: `defineComet(Component, import.meta.url)`
 * registers the Comet under a path that is deleted a moment later, and the production build cannot
 * recognise it as the real Comet it is. This function replaces each `import.meta.url` and
 * `import.meta.filename` that the code really contains with a string literal holding the original
 * module's `file:` URL and path.
 *
 * Relative references keep their meaning: the copy sits in the same directory as the original, so
 * `new URL('./sibling.ts', import.meta.url)` resolves to the same file whether it starts from the
 * copy or from the original. `import.meta.dirname`, `import.meta.resolve(...)` and `import.meta.main`
 * are left alone for the same reason (the same directory) or because they say nothing about the
 * file's name.
 *
 * The lexer reports the real `import.meta` expressions only: the same text in a comment or in a string
 * (a doc comment quoting an example) is not touched.
 *
 * @param code - The module's code, after its specifiers were rewritten.
 * @param originalUrl - The `file:` URL of the module the code was rewritten from.
 * @returns The code with the original URL and path in place of the copy's.
 */
export function pinImportMeta(code: string, originalUrl: string): string {
  const [imports] = parseEsModule(code)
  const pins: Array<{ start: number; end: number; value: string }> = []

  for (const imp of imports) {
    // `d === -2` marks an `import.meta` expression (`s`..`e` spans `import.meta`).
    if (imp.d !== -2) continue
    const property = IMPORT_META_PROPERTY_RE.exec(code.slice(imp.e))
    if (!property) continue
    const value = property[1] === 'url' ? originalUrl : fromFileUrl(originalUrl)
    pins.push({ start: imp.s, end: imp.e + property[0].length, value })
  }

  // Back to front, so every earlier offset stays valid as later ones are spliced in.
  let pinned = code
  for (const { start, end, value } of pins.sort((a, b) => b.start - a.start)) {
    pinned = pinned.slice(0, start) + JSON.stringify(value) + pinned.slice(end)
  }
  return pinned
}
