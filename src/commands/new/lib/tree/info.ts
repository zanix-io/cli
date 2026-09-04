import type { ZanixLibraries } from '@zanix/types'

/**
 * Moved here from `@zanix/utils` — this is `cli`'s own `zanix new` project-tree machinery, not a
 * transversal utility (verified: zero consumers outside `cli` ecosystem-wide). `getLatestRelease`
 * was dropped during the move — confirmed unused anywhere in the ecosystem.
 */

const titleRegex = /<title>(v[\d\.]+)<\/title>/

/**
 * Throws (never falls back to the literal string `'latest'`) when the Shields.io badge fetch
 * itself fails, or when its HTML doesn't match the expected `<title>` shape. A fallback to
 * `'latest'` is never a working substitute: JSR's real file-serving URLs
 * (`https://jsr.io/<lib>/<version>/<path>`, built from this value by `getZanixTemplateContent`)
 * 404 on the literal segment `'latest'`, so a silent fallback here only defers the failure to a
 * second, differently-swallowed spot downstream.
 */
const getShieldsDataVersion = async (
  endpoint: string,
  username: string,
  lib: string,
): Promise<string> => {
  const badgeUrl = `https://img.shields.io/${endpoint}/${username}/${lib}?color=blue&&label=`

  let html: string
  try {
    const response = await fetch(badgeUrl)
    html = await response.text()
  } catch (error) {
    throw new Error(
      `Failed to fetch the latest published version of '${username}/${lib}' from Shields.io ('${badgeUrl}')`,
      { cause: error },
    )
  }

  const version = html.match(titleRegex)?.[1].replace('v', '')

  if (!version) {
    throw new Error(
      `Could not determine the latest published version of '${username}/${lib}' — Shields.io's ` +
        `response for '${badgeUrl}' did not contain the expected '<title>vX.Y.Z</title>'.`,
    )
  }

  return version
}

/**
 * Fetches the lates JSR version of a repository (e.g., @zanix/utils) from Shields.io.
 * This function retrieves the version of a library by querying the Shields.io JSR badge URL.
 *
 * Throws if the library's version can't be determined (network failure, or an unexpected
 * Shields.io response) — never silently resolves to a fallback version like `'latest'`.
 *
 * @param lib - library name
 * @param username - library username. Defaults to `@zanix`
 * @returns x.x.x version
 */
export function getLatestVersion(
  lib: string,
  username = '@zanix',
): Promise<string> {
  return getShieldsDataVersion('jsr/v', username, lib)
}

const libraryVersionCache = new Map<keyof ZanixLibraries, Promise<string>>()

/**
 * Fetches (and memoizes, per library, for the lifetime of this process) the latest published
 * version of exactly ONE Zanix library — e.g. `getZanixLibraryVersion('@zanix/utils')`.
 *
 * Resolves exactly the one library a call needs, never every `ZanixLibraries` key at once:
 * `getZanixTemplateContent` (this function's only real consumer) resolves one specific library per
 * call, and only ONE of the nine `ZanixLibraries` is ever requested anywhere under
 * `commands/new/lib/tree` today — `'@zanix/utils'`, for `commons.ts`'s own generic,
 * non-API-coupled project skeleton (README/LICENSE/CHANGELOG/`docs/see-more.md`/example test and
 * utility files, shared by every project type). `library.ts`'s own `mod.ts`/`src/modules/mod.ts`
 * are both generated locally (see `getLibraryRootModTemplate`/`getLibraryModTemplate`,
 * `docs/engineering.md` §5), never requesting a version at all. `projects/main.ts`'s shared
 * `pipe.defs.ts`/`interceptor.defs.ts` leaf is likewise generated locally via `zanix generate
 * middleware`'s own `planMiddleware`, the same generator-is-the-source-of-truth approach
 * `handler`/`rto`/`repository`/`seeder`/`connector`/`interactor`/`job` also follow — `@zanix/core`
 * never had a real `src/templates/` for this to resolve against, so it's never one of the calls
 * `getZanixLibraryVersion` handles either. Resolving every one of those calls through a
 * batch of all nine libraries at once would mean an unrelated, never-actually-requested library
 * that can't be resolved at all breaks EVERY `zanix new` invocation — `'@zanix/worker'` is not
 * published on JSR as of this writing (Shields.io's own badge response for it is the literal text
 * `"package not found"`), which is exactly the failure mode a batched resolve would expose on
 * every invocation even though nothing under `commands/new/lib/tree` ever actually requests it.
 *
 * A rejection is never cached — a transient failure (a network blip) shouldn't permanently poison
 * every subsequent template file's lookup for the rest of the same `zanix new` run.
 *
 * @param lib - the fully-qualified library key, e.g. `'@zanix/utils'`.
 * @returns x.x.x version
 */
export function getZanixLibraryVersion(lib: keyof ZanixLibraries): Promise<string> {
  const cached = libraryVersionCache.get(lib)
  if (cached) return cached

  const [username, libName] = lib.split('/') as [string, string]
  const promise = getLatestVersion(libName, username)
  promise.catch(() => libraryVersionCache.delete(lib))
  libraryVersionCache.set(lib, promise)

  return promise
}
