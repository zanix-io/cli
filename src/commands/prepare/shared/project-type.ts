import type { ZanixProjects } from '@zanix/types'
import type { Commander } from 'cli'

/**
 * The complete, real `ZanixProjects` union (`'library' | 'server' | 'space' | 'space-server' |
 * 'app'`), kept here as a runtime value so `assertValidProjectType` below can check a raw CLI
 * flag against it — `ZanixProjects` itself only exists at the type level and can't be inspected at
 * runtime on its own.
 */
const VALID_PROJECT_TYPES: readonly ZanixProjects[] = [
  'library',
  'server',
  'space',
  'space-server',
  'app',
]

/**
 * Guards the single, shared `--project-type` flag both `zanix prepare -d/--docker` and
 * `zanix prepare -g/--github` accept, before either passes it on (as `options.projectType as
 * ZanixProjects`) to `prepareDocker`/`prepareGithub`.
 *
 * `undefined` is explicitly allowed: the flag is optional, and each downstream consumer
 * (`docker-file.ts`, `workflow.ts`) already has its own default for the omitted case. What this
 * guards against is a value that IS present but isn't a real `ZanixProjects` member — e.g. a typo
 * like `--project-type foobra`. Without this check that case would be indistinguishable at runtime
 * from a project type a given file legitimately has nothing to generate for (e.g. `docker-file.ts`
 * warns and skips the `Dockerfile` for `'library'`, by design) — both would take the same
 * warn-and-skip path, silently, with the same exit 0. A real typo must throw, not warn-and-skip.
 *
 * Call this at the very top of each action, before the existing `options.projectType as
 * ZanixProjects` cast and before any other work — that cast is otherwise unchecked, and for
 * `--docker` specifically an invalid value would still produce partial output (`.dockerignore`
 * written unconditionally, `Dockerfile` silently not) without this guard.
 *
 * @param cwd - The running `Commander`, used to route the failure through `cwd.throw` the same way
 * every other CLI-input validation in this codebase does (e.g. `--hooks-engine`'s own validation in
 * `github.ts`).
 * @param projectType - The raw, not-yet-cast `options.projectType` value from Cliffy's option
 * parsing.
 */
export function assertValidProjectType(cwd: Commander, projectType: unknown): void {
  if (projectType === undefined) return

  if (!VALID_PROJECT_TYPES.includes(projectType as ZanixProjects)) {
    const allowedList = VALID_PROJECT_TYPES.map((type) => `'${type}'`).join(', ')
    cwd.throw(
      new Error(
        `Invalid project type '${projectType}' using cli command. Allowed values are: ${allowedList}`,
      ),
    )
  }
}
