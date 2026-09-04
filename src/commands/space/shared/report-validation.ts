import type { Commander } from 'cli'
import type { Diagnostic } from '@zanix/space'

import logger from '@zanix/utils/logger'

/**
 * Presents document-validation results in a terminal.
 *
 * **Presentation only.** Whether a finding exists, how severe it is and whether it should block are
 * all decided in `@zanix/space`'s validation module; this file decides how the outcome is worded and
 * where it is written. Keeping that split is what stops the CLI from acquiring policy: a rule
 * softened here would have no code, no basis and no way for a project to configure it.
 *
 * Shared between `zanix space build` and `zanix space dev` so both report the same findings the same
 * way. The only difference is what they do afterwards — a build fails, a dev server keeps running.
 *
 * @module
 */

/**
 * What {@linkcode reportValidation} is given.
 *
 * `diagnostics` carries the real {@linkcode Diagnostic} from `@zanix/space`, imported as a TYPE
 * only — erased at compile time, so this module still adds no runtime dependency on the validation
 * engine. An earlier version declared a structural `{ severity }` shape instead, to avoid exactly
 * that dependency; it turned out to cost more than it saved. It restated part of a contract that
 * already exists, and it hid the rest: `basis` and `resolution` were unreachable here, so
 * presentation could never explain WHY a warning became an error, even though the model records it.
 *
 * Note that this module reads no field of a diagnostic at all today — only how many there are.
 * Every severity-dependent decision (the summary line, the formatted output, whether the run
 * blocks) is made by the validation module and arrives here already resolved.
 */
export type ValidationReport = {
  diagnostics: Diagnostic[]
  /** Checks that could not run, with their reasons. */
  skipped: string[]
  /**
   * Each finding, already formatted by `@zanix/space`'s own `formatDiagnostic`, paired with the
   * severity that decides which logger channel it goes to.
   *
   * The caller formats rather than this module, deliberately: formatting lives in the validation
   * package, and importing it here as a VALUE would pull the engine into a file that only prints.
   * What this module owns is the routing — which channel, and therefore which colour — and that is
   * genuinely presentation.
   */
  entries: Array<{ severity: Diagnostic['severity']; text: string }>
  /** `true` when at least one finding is an error — from `@zanix/space`'s own
   * `hasBlockingDiagnostics`, never recomputed here. */
  blocking: boolean
}

/**
 * Writes a validation report.
 *
 * Skipped checks are printed even when nothing was found, and that is the point: a validator that
 * silently omits work reads exactly like one that found nothing wrong. A reader has to be able to
 * tell "clean" from "not checked".
 *
 * @returns `true` when the run contains at least one error, so a caller can decide what that means
 * for it. This function never exits, throws or fails a build itself.
 */
export function reportValidation(report: ValidationReport): boolean {
  const { diagnostics, skipped, entries, blocking } = report

  // Grouped by severity, one logger call per group, header and findings in the SAME message.
  // Splitting them across calls put a blue INFO header above yellow WARNING lines, so the run's
  // shape was only readable by reconstructing it from consecutive lines. Grouping also keeps colour
  // meaningful: a run with one error and three warnings shows a red block and a yellow one, rather
  // than colouring everything by whichever severity happened to be highest.
  for (const severity of ['error', 'warning', 'info'] as const) {
    const group = entries.filter((entry) => entry.severity === severity)
    if (group.length === 0) continue

    const noun = severity === 'info' ? 'info' : `${severity}${group.length === 1 ? '' : 's'}`
    const body = group.map((entry) => `- ${entry.text.trimStart()}`).join('\n\n')
    const message = `Document validation: ${group.length} ${noun}\n${body}`

    // Every call passes `'noSave'`: this is build feedback for whoever is watching the terminal,
    // not something to persist into the app's own log store — `logger.warn`/`logger.error` save by
    // default, unlike `debug`/`success`.
    if (severity === 'error') logger.error(message, 'noSave')
    else if (severity === 'warning') logger.warn(message, 'noSave')
    else logger.info(message, 'noSave')
  }

  if (diagnostics.length === 0) logger.success('Document validation: no issues')

  if (skipped.length > 0) {
    logger.info(
      `Not checked (${skipped.length}):\n${skipped.map((entry) => `- ${entry}`).join('\n')}`,
      'noSave',
    )
  }

  return blocking
}

/** Fails a command when validation produced at least one error. Separated from
 * {@linkcode reportValidation} so `dev`, which keeps running, can report without failing. */
export function failOnBlockingDiagnostics(cwd: Commander, blocking: boolean): void {
  if (!blocking) return
  cwd.throw(
    new Error(
      'Document validation failed: at least one error. Run with --no-validation to skip it, or ' +
        'see the findings above for what to fix.',
    ),
  )
}
