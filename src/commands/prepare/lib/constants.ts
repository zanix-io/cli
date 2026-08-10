import type { Editors } from 'commands/prepare/lib/typings.ts'

/**
 * Constants for `zanix prepare`'s git/editor scaffolding. Moved here from `@zanix/utils`'s
 * `constants.ts` default export — verified this batch's only real consumer ecosystem-wide is
 * `cli` itself (unlike `MAIN_MODULE`/`DISTRIBUTION_FILE`/`CONFIG_FILE`, which stay in `utils`
 * because other, non-cluster code genuinely depends on them).
 */

export const GITHUB_HOOKS_FOLDER = '.github/hooks'
export const GITHUB_WORKFLOW_FOLDER = '.github/workflows'
export const GIT_HOOKS_FOLDER = '.git/hooks'
export const editors: Record<Editors, { FOLDER: string; FILENAME: string }> = {
  vscode: { FOLDER: '.vscode', FILENAME: 'settings.json' },
}
