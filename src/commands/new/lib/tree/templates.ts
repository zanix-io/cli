import type { ZanixLibraries } from '@zanix/types'

import { getAllZanixLibrariesInfo } from 'commands/new/lib/tree/info.ts'
import { readFileFromCurrentUrl } from 'utils/read-current-file.ts'

/**
 * Function to get template file content
 */
export async function getZanixTemplateContent(
  { url, path, jsr }: {
    url: string
    path: string
    jsr?: keyof ZanixLibraries
  },
) {
  if (jsr) {
    const libs = await getAllZanixLibrariesInfo()
    url = `https://jsr.io/${jsr}/${libs[jsr].version}/{current}`
  }

  return readFileFromCurrentUrl(url, path).catch(() => '')
}
