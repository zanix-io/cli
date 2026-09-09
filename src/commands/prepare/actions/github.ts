import type { ZanixProjects } from '@zanix/types'
import type { Commander } from 'cli'

import { prepareGithub } from 'commands/prepare/lib/github/prepare.ts'
import { assertValidProjectType } from 'commands/prepare/shared/project-type.ts'

/**
 * `zanix prepare -g/--github`'s real orchestration — maps `--hooks-engine` (`'native'`, the
 * default, or `'framework'`) onto `prepareGithub`'s own `usePrecommit` option: `'framework'` sets
 * `usePrecommit`, which switches which hook mechanism Git actually runs (see `prepareGithub`'s own
 * doc for the "both files exist, only one gets linked" detail); any other value throws through
 * `this.throw`. `--publish` (left as `undefined` when omitted) is forwarded straight through to
 * `createGitWorkflows`'s own `publish` option, unresolved — that function owns the actual
 * `projectType`-based default, not this action.
 */
function prepareGithubAction(
  this: Commander,
  options: {
    projectType?: unknown
    fmtFiles?: string
    lintFiles?: string
    hooksEngine?: unknown
    publish?: boolean
  },
  root?: string,
) {
  assertValidProjectType(this, options.projectType)

  const projectType = options.projectType as ZanixProjects
  const hooksEngine = options.hooksEngine || 'native'

  const formatFiles = options.fmtFiles?.split(',') as never
  const lintFiles = options.lintFiles?.split(',') as never

  let usePrecommit: { baseRoot?: string } | undefined

  switch (hooksEngine) {
    case 'native':
      break
    case 'framework':
      usePrecommit = { baseRoot: root }
      break
    default:
      this.throw(
        new Error(
          `Invalid hooks engine '${hooksEngine}' using cli command. Allowed values are: 'native', 'framework'`,
        ),
      )
  }

  return prepareGithub({
    root,
    usePrecommit,
    legacyHooks: {
      preCommit: {
        filePatterns: { lint: lintFiles, fmt: formatFiles },
        baseRoot: root,
      },
      prePush: { baseRoot: root },
    },
    publishWorkflow: { projectType, publish: options.publish, baseRoot: root },
    gitIgnoreBase: { baseRoot: root },
  }).catch((e) => {
    this.throw(e)
  })
}

export default prepareGithubAction
