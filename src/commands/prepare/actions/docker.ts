import type { ZanixProjects } from '@zanix/types'
import type { Commander } from 'cli'

import { prepareDocker } from 'commands/prepare/lib/docker/prepare.ts'

/** `zanix prepare -d/--docker`'s real orchestration — generates the `Dockerfile` (per
 * `--project-type`) and `.dockerignore`; a real rejection from either (e.g. malformed project
 * config) routes through `this.throw` instead of an unhandled rejection. */
function prepareDockerAction(
  this: Commander,
  options: { projectType?: unknown },
  root?: string,
) {
  const projectType = options.projectType as ZanixProjects

  return prepareDocker({
    dockerfile: { projectType, baseRoot: root },
    dockerIgnore: { baseRoot: root },
  }).catch((e) => {
    this.throw(e)
  })
}

export default prepareDockerAction
