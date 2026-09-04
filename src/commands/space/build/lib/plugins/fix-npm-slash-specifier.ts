/**
 * Workaround for two real, confirmed, LAYERED upstream bugs in `@deno/vite-plugin@2.0.3` (not
 * `@zanix/space`'s or `cli`'s own doing) — both root-caused via direct instrumentation of the
 * installed package and live HTTP verification against a real `zanix space dev` server, not
 * guessed.
 *
 * **Bug 1 — a malformed `npm:` specifier.** `@deno/loader` bakes a resolved bare specifier
 * straight into a transpiled HTTPS-sourced module's own code text; resolving a bare npm import
 * (`'react-dom/client'`, `'preact'`, ...) against an HTTPS referrer
 * (`https://jsr.io/@zanix/space/<version>/...` — exactly how every real consumer's own
 * `@zanix/space/client`/`@zanix/space/client/preact` resolves, in BOTH `zanix space build` and
 * `zanix space dev`, whenever it isn't locally linked) emits a specifier with a leading slash
 * right after the `npm:` scheme — `npm:/react-dom@^19.2.0/client` — instead of the correct
 * `npm:react-dom@^19.2.0/client`. Confirmed: the SAME import resolved against a `file://` referrer
 * instead never gets that extra slash — this is specific to the HTTPS-referrer path every real,
 * non-locally-linked consumer always takes. Left alone, `@deno/vite-plugin`'s own `resolveDeno()`
 * (`resolver.js`) parses the bare package name via `id.slice(4)` — stripping only the literal
 * `"npm:"`, never a following `/` — so for the leading-slash form this yields `name =
 * "/react-dom"`, slash included, which `prefixPlugin.js` hands straight to Rollup's own
 * `this.resolve("/react-dom")` as if it were a real absolute filesystem path — a nonsensical
 * `../../../../.../react-dom` relative offset, surfacing as `[UNLOADABLE_DEPENDENCY] Could not
 * load ../.../react-dom` (`zanix space build`) or a served-but-broken import (`zanix space dev`).
 *
 * **Bug 2 — `resolveDeno()`'s own `npm:` handling drops the subpath entirely, even once the
 * leading slash is gone.** For a WELL-FORMED `npm:react-dom@^19.2.0/client`, the SAME
 * `id.slice(4)`-then-`indexOf("@")` parse in `resolver.js` extracts only the bare package name —
 * `"react-dom"` — and discards `/client` outright; the returned `{ id: "react-dom", kind: "npm" }`
 * is all `prefixPlugin.js` ever hands to Rollup's `this.resolve()`. Confirmed live (2026-08-30,
 * curling a real `zanix space dev` server running through the GLOBALLY INSTALLED `zanix` binary,
 * with only Bug 1's fix applied): `hydrate-comets.ts`'s served code resolved `react-dom/client`
 * to `.../react-dom/index.js` — the package ROOT, which exports neither `createRoot` nor
 * `hydrateRoot` (both are `react-dom/client`-only) — surfacing at runtime as `TypeError:
 * hydrateRoot is not a function`, a DIFFERENT failure from Bug 1's build-time crash, easy to
 * mistake for a leftover Bug 1 if only the leading slash is fixed.
 *
 * **The fix: skip both buggy code paths entirely**, rather than patch either one's own output.
 * Neither bug is reachable at all for a PLAIN bare specifier with no `npm:` scheme prefix (`react`
 * resolves correctly right next to this exact broken `react-dom` import, in the SAME transpiled
 * file, going through `import.meta.resolve`'s own subpath-aware resolution instead of
 * `resolveDeno()`'s lossy `npm:` branch) — so this `transform` hook rewrites the WHOLE malformed
 * `npm:/<pkg>@<version>[/<subpath>]` specifier (leading slash or not) back down to the plain bare
 * form `<pkg>[/<subpath>]`, recovering exactly what the original, untranspiled source actually
 * wrote (`'react-dom/client'`, not any `npm:`-prefixed form at all). Runs on a module's own loaded
 * code BEFORE Rollup/Vite ever parses import statements out of it to call `resolveId`, so by the
 * time `resolveId` sees the specifier, it's the correct bare form and neither buggy branch in
 * `resolver.js` ever runs on it — no patch to `@deno/vite-plugin` itself needed, and no local link
 * to `@zanix/space`'s own checkout needed either. Confirmed via a real, isolated spike run
 * 2026-08-30 (pure-JSR `@zanix/space/client`, both `zanix space build` and a live `zanix space
 * dev` HTTP response) that this two-bug-aware rewrite is what actually resolves `react-dom/client`
 * to a real, loadable file — the leading-slash-only fix alone was NOT sufficient, confirmed by
 * reproducing Bug 2 live before this version of the fix. Revert once `@deno/vite-plugin` fixes
 * `resolveDeno`'s `npm:` handling upstream (both the leading slash and the subpath loss) — this
 * workaround becomes a permanent no-op the moment the buggy form stops appearing (the
 * `code.includes('npm:/')` / `code.includes('npm:')`-adjacent guard below means it costs nothing
 * once that happens).
 *
 * @module
 */

/** The minimal structural shape Vite/Rollup actually need from a plugin object for a `transform`
 * hook — not the real `vite` package's own `Plugin` type, deliberately: `cli`'s own `deno.jsonc`
 * has no direct `vite` dependency declared (only `@zanix/space` does, transitively), and importing
 * `Plugin` from `'vite'` just for this one type would force adding one solely to satisfy the
 * type-checker. Both `@zanix/space/vite`'s own `buildSpaceClient({ plugins })` and `@zanix/space`'s
 * own `createSpaceDevEngine({ plugins })` accept any object matching Vite's real `Plugin` shape —
 * this structural subset is all a `transform`-only plugin needs from it. */
interface TransformOnlyVitePlugin {
  name: string
  transform(code: string, id: string): string | null
}

/** Matches a full malformed `npm:/<pkg>@<version>[/<subpath>]` specifier (leading slash optional —
 * covers both the well-formed-but-lossy and the leading-slash form) inside a quoted string, and
 * captures the bare package name (`$2`, handling a scoped `@org/pkg` name as one unit) and any
 * subpath (`$3`) separately from the `npm:`/leading-slash/version-range text being discarded.
 * Never matches a legitimate occurrence: a real source file never writes an npm: scheme specifier
 * by hand for a bare import like `'react-dom/client'` — only `@deno/loader`'s own transpilation
 * output does, and only in this malformed shape (see this module's own doc for why). */
const NPM_SCHEME_SPECIFIER_RE =
  /(['"])npm:\/?(@[^/'"]+\/[^@'"]+|[^@/'"]+)@[^/'"]+((?:\/[^'"]*)?)\1/g

/**
 * Returns a Vite `transform` plugin that rewrites `@deno/loader`'s malformed `npm:`-scheme
 * specifier output back down to the plain bare specifier the original source actually wrote — see
 * this module's own doc for the full, two-bug mechanism this sidesteps. Safe to include
 * unconditionally in every `zanix space build`/`zanix space dev` Vite plugin array: the
 * `code.includes('npm:')` guard makes it a genuine no-op for any module that never hits either bug,
 * and the replacement only ever touches a quoted `npm:/?<pkg>@<version>[/<subpath>]` substring —
 * nothing else in a module's own code can accidentally match that shape.
 */
export function fixNpmSlashSpecifierPlugin(): TransformOnlyVitePlugin {
  return {
    name: 'zanix-cli-fix-npm-slash-specifier',
    transform(code) {
      if (!code.includes('npm:')) return null
      const fixed = code.replace(NPM_SCHEME_SPECIFIER_RE, '$1$2$3$1')
      return fixed === code ? null : fixed
    },
  }
}
