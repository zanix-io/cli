import { getPathFromCurrent, isFileUrl } from '@zanix/helpers'

/**
 * Reads the contents of a `file` from a given `URL`, either from the local filesystem or over
 * HTTP/HTTPS. Moved here from `@zanix/utils` — shared by `cli`'s own `zanix new` project-tree
 * scaffolding and `zanix prepare`'s git/editor scaffolding, its only real consumers
 * ecosystem-wide (verified); `@zanix/utils` never consumed this itself, only hosted it.
 */
export async function readFileFromCurrentUrl(
  url: string,
  relativeFromPath: string,
): Promise<string> {
  const currentUrl = getPathFromCurrent(url, relativeFromPath)

  if (isFileUrl(url)) return Deno.readTextFile(currentUrl)

  const response = await fetch(currentUrl)

  return response.ok ? response.text() : ''
}
