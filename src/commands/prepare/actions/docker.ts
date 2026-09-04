import type { ZanixProjects } from '@zanix/types'
import type { Commander } from 'cli'

import { prepareDocker } from 'commands/prepare/lib/docker/prepare.ts'
import { assertValidProjectType } from 'commands/prepare/shared/project-type.ts'

/** `zanix prepare -d/--docker`'s real orchestration — generates the `Dockerfile` (per
 * `--project-type`) and `.dockerignore`; a real rejection from either (e.g. malformed project
 * config, or a genuine write failure — see `createDockerBaseFile`'s own doc for why that rejects
 * instead of resolving `false`) routes through `this.throw` instead of an unhandled rejection or a
 * silent exit 0. */
function prepareDockerAction(
  this: Commander,
  options: { projectType?: unknown },
  root?: string,
) {
  assertValidProjectType(this, options.projectType)

  const projectType = options.projectType as ZanixProjects

  return prepareDocker({
    dockerfile: { projectType, baseRoot: root },
    dockerIgnore: { baseRoot: root },
  }).catch((e) => {
    this.throw(e)
  })
}

export default prepareDockerAction
