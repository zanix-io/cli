import type { Command } from '@cliffy/command'
import type { ZanixProjects } from '@zanix/types'

import { prepareGithub } from '@zanix/helpers'

function prepareGithubAction(
  this: Command,
  options: { projectType?: unknown; fmtFiles?: string; lintFiles?: string },
) {
  const projectType = options.projectType as ZanixProjects

  const formatFiles = options.fmtFiles?.split(',') as never
  const lintFiles = options.lintFiles?.split(',') as never

  return prepareGithub({
    publishWorkflow: { projectType },
    preCommitHook: {
      filePatterns: { lint: lintFiles, fmt: formatFiles },
    },
  }).catch((e) => {
    this.throw(e)
  })
}

export default prepareGithubAction
