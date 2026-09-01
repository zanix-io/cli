/**
 * Boilerplate for `zanix generate job <name> [--cron <expression>]`.
 *
 * Embedded as a string-template function for the same reason as `seeder/template.ts`/
 * `repository/template.ts`/`handler/template.ts`: `zanix build` bundles this command's code into
 * a single `.dist/app.mjs` output by default.
 *
 * `jobName`/`cronExpression` are free text (`jobName` has no identifier validation — `job` doesn't
 * emit a PascalCase class name at all — and `cronExpression` is an unvalidated `--cron` flag), so
 * both are routed through `escapeTsStringLiteral` right where they're embedded in a string literal
 * below — see that helper's own doc for why this is required, not optional.
 *
 * Shape confirmed directly against `@zanix/asyncmq`'s real source (`src/modules/jobs/
 * {cron,task}.defs.ts`), not assumed: `registerJob`/`registerCronJob` share the exact same
 * `JobProcess` union for queue routing (`processingQueue`+`handler`, or `customQueue`) —
 * `registerCronJob`'s only extra required fields are `isActive` and `schedule`. Content otherwise
 * verbatim from `@zanix/asyncmq`'s own real `src/templates/src/server/jobs/job.defs.ts` (this
 * repo's previous single source of truth for the cron shape, retired in favor of this generator).
 *
 * Imports from `@zanix/asyncmq/jobs`, not the bare `@zanix/asyncmq` root — that subpath re-exports
 * only job/cron registration (no RabbitMQ connector), so a generated job never pulls in `amqplib`
 * just by existing.
 */

import { escapeTsStringLiteral } from 'commands/generate/shared/escape-template-string.ts'

/** `jobs/<name>.defs.ts` — cron variant, scheduled on a recurring cron expression. */
const cronJobTemplate = (jobName: string, cronExpression: string): string =>
  `import { registerCronJob } from '@zanix/asyncmq/jobs'

registerCronJob({
  name: '${escapeTsStringLiteral(jobName)}',
  isActive: true,
  processingQueue: 'soft',
  schedule: '${escapeTsStringLiteral(cronExpression)}',
  handler: function () {
    // Run the recurring work here, e.g.:
    // const repository = this.providers.get(ExampleRepository)
  },
})
`

/** `jobs/<name>.defs.ts` — queue variant, run on demand via a `Worker Provider`. */
const queueJobTemplate = (jobName: string): string =>
  `import { registerJob } from '@zanix/asyncmq/jobs'

registerJob({
  name: '${escapeTsStringLiteral(jobName)}',
  processingQueue: 'soft',
  handler: function () {
    // Run the on-demand work here, e.g.:
    // const repository = this.providers.get(ExampleRepository)
  },
})
`

/**
 * `jobs/<name>.defs.ts` — `registerCronJob` when `cronExpression` is given (schedule-driven),
 * `registerJob` otherwise (queue-consumed, run via `this.worker.runJob`/`runTask`).
 */
export const jobTemplate = (jobName: string, cronExpression?: string): string =>
  cronExpression ? cronJobTemplate(jobName, cronExpression) : queueJobTemplate(jobName)
