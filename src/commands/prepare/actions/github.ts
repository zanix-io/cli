import type { ZanixProjects } from '@zanix/types'
import type { Commander } from 'cli'

import { prepareGithub } from '@zanix/helpers'

function prepareGithubAction(
  this: Commander,
  options: { projectType?: unknown; fmtFiles?: string; lintFiles?: string },
  root?: string,
) {
  const projectType = options.projectType as ZanixProjects

  const formatFiles = options.fmtFiles?.split(',') as never
  const lintFiles = options.lintFiles?.split(',') as never

  return prepareGithub({
    publishWorkflow: { projectType, baseRoot: root },
    preCommitHook: {
      filePatterns: { lint: lintFiles, fmt: formatFiles },
      baseRoot: root,
    },
    pushHook: { baseRoot: root },
    gitIgnoreBase: { baseRoot: root },
  }).catch((e) => {
    this.throw(e)
  })
}

export default prepareGithubAction
