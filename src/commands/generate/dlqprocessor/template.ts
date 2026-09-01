/**
 * Boilerplate for `zanix generate dlqprocessor <name> --process-type <type> --schedule <cron>`.
 *
 * Embedded as a string-template function for the same reason as every other generator template:
 * `zanix build` bundles this command's code into a single `.dist/app.mjs` output by default.
 *
 * Shape confirmed directly against `@zanix/asyncmq`'s real source (`src/modules/jobs/dlq.defs.ts`)
 * and `@zanix/datamaster`'s (`src/modules/dlq/dlq.model.ts`), not assumed: `registerDLQProcessor`
 * (from `@zanix/asyncmq/dlq`) is a thin `registerCronJob` wrapper that claims one eligible DLQ
 * entry per tick and runs `handler` against it; `registerDLQModel` (from `@zanix/datamaster`'s
 * root) is a separate, one-time-per-app call that must run before `DLQProvider`/
 * `registerDLQProcessor` can resolve the DLQ collection at all — see `dlqModelTemplate` below.
 *
 * `kebabName`/`processType`/`schedule` are all free text (`kebabName` has no identifier validation
 * — `dlqprocessor` doesn't emit a PascalCase class name at all — and `processType`/`schedule` are
 * unvalidated `--process-type`/`--schedule` flags), so all three are routed through
 * `escapeTsStringLiteral` right where they're embedded in a string literal below — see that
 * helper's own doc for why this is required, not optional.
 */

import { escapeTsStringLiteral } from 'commands/generate/shared/escape-template-string.ts'

/** `dlq/<name>.defs.ts` — one `registerDLQProcessor` call per reprocessing job. */
export const dlqProcessorTemplate = (
  kebabName: string,
  processType: string,
  schedule: string,
): string =>
  `import { registerDLQProcessor } from '@zanix/asyncmq/dlq'

registerDLQProcessor('${escapeTsStringLiteral(processType)}', {
  name: '${escapeTsStringLiteral(kebabName)}',
  schedule: '${escapeTsStringLiteral(schedule)}',
  isActive: true,
  processingQueue: 'soft',
  handler: async function (entry) {
    // Reprocess the failed entry here, e.g.:
    // const repository = this.providers.get(ExampleRepository)
    // await repository.retry(entry.payload)
  },
})
`

/**
 * `repositories/dlq.defs.ts` — registers `@zanix/datamaster`'s own DLQ model. Required exactly
 * once per app (never once per processor) before `DLQProvider`/`registerDLQProcessor` can resolve
 * it — written the first time `zanix generate dlqprocessor` runs, at a fixed path so a second run
 * never duplicates it (see `planDlqProcessor`'s own doc in `command.ts` for how that's enforced).
 */
export const dlqModelTemplate = (): string =>
  `import { registerDLQModel } from '@zanix/datamaster'

registerDLQModel()
`
