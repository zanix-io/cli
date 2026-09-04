import type { ZanixLibraries } from '@zanix/types'

import { getZanixLibraryVersion } from 'commands/new/lib/tree/info.ts'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'

/**
 * Function to get template file content.
 *
 * Propagates (never swallows) a `readFileFromCurrentUrl`/`getZanixLibraryVersion` rejection — a
 * failed fetch (no network, JSR down), a non-OK HTTP response, or an unresolvable library version
 * surfaces to the caller as a real error, never silently falls back to `''`/`'latest'`: a silent
 * fallback here would let `createFilesAndFolders` write a 0-byte file straight to disk while
 * `zanix new` still reports success. Resolves the ONE `jsr` library this specific call needs via
 * `getZanixLibraryVersion` — see that function's own doc for why resolving every `ZanixLibraries`
 * key up front, instead of just the one requested here, would break every `zanix new` invocation
 * the moment any single unrequested library can't be resolved.
 */
export async function getZanixTemplateContent(
  { url, path, jsr }: {
    url: string
    path: string
    jsr?: keyof ZanixLibraries
  },
) {
  if (jsr) {
    const version = await getZanixLibraryVersion(jsr)
    url = `https://jsr.io/${jsr}/${version}/{current}`
  }

  return readFileFromCurrentUrl(url, path)
}
