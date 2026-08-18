import type { PrepareDockerOptions } from 'commands/prepare/lib/typings.ts'

import { createDockerfile } from './files/docker-file.ts'
import { createDockerignoreFile } from 'commands/prepare/lib/docker/files/dockerignore.ts'

/**
 * Prepares Docker packaging for the project — a `Dockerfile` (skipped, with a warning, for
 * `'library'`, the one project type that never calls `Deno.serve()` at all — see
 * {@link createDockerfile}'s own doc for what the `'app'` variant additionally scaffolds) and a
 * `.dockerignore` (always created, regardless of type).
 *
 * @param options Configuration options for the Docker files.
 *   - `dockerfile`: Optional configuration for the `Dockerfile` creation.
 *   - `dockerIgnore`: Optional configuration for the `.dockerignore` creation.
 */
export function prepareDocker(
  options: PrepareDockerOptions = {},
): Promise<boolean[]> {
  const { dockerfile, dockerIgnore } = options

  return Promise.all([
    createDockerfile(dockerfile),
    createDockerignoreFile(dockerIgnore),
  ])
}
