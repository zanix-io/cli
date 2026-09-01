import { getPathFromCurrent, isFileUrl } from '@zanix/helpers'

/**
 * Reads the contents of a `file` from a given `URL`, either from the local filesystem or over
 * HTTP/HTTPS. Lives in `cli`, not `@zanix/utils` — shared by `cli`'s own `zanix new`
 * project-tree scaffolding and `zanix prepare`'s git/editor scaffolding, its only real consumers
 * ecosystem-wide.
 *
 * Throws (never returns a fallback value) when the remote fetch itself fails to connect, and also
 * throws — naming the URL and the real HTTP status — for a non-OK response (404/500/JSR down).
 * A non-OK response is a real failure every caller must not silently absorb: a fallback empty
 * string would get written straight to disk as a 0-byte file, with `zanix new`/`zanix prepare`
 * still reporting success.
 */
export async function readFileFromCurrentUrl(
  url: string,
  relativeFromPath: string,
): Promise<string> {
  const currentUrl = getPathFromCurrent(url, relativeFromPath)

  if (isFileUrl(url)) return Deno.readTextFile(currentUrl)

  const response = await fetch(currentUrl)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch '${currentUrl}': ${response.status} ${response.statusText}`,
    )
  }

  return response.text()
}
