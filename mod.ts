/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

// Dynamic import (not a static one) so this same try/catch also catches errors thrown while
// `./src/cli.ts` and its own import graph are being loaded/evaluated — not just errors from
// `cli.parse()` itself. A static top-level throw anywhere in that graph (the class of bug this
// guards against: `@zanix/server`'s `readConfig()` used to run eagerly at module load time)
// would otherwise happen before this file's own top-level code, including a try/catch wrapped
// only around `cli.parse()`, ever ran.
//
// This is a last-resort safety net, not a substitute for fixing root causes: it only guarantees
// that whatever escapes every other error handler is still reported and still exits non-zero,
// instead of silently exiting 0.
try {
  const { default: cli } = await import('./src/cli.ts')
  const { wasForceExitRequested } = await import('./src/utils/force-exit.ts')

  const args = Deno.args.length === 0 ? ['-h'] : Deno.args

  await cli.parse(args)

  // OPT-IN only — an unconditional exit here can't work: `cli.parse()` resolving is not, by
  // itself, proof a command is done in any exitable sense. `space dev`'s own action ALSO returns
  // as soon as `bootstrapServers()` resolves, relying on Deno's event loop (the open listener) to
  // keep the process alive afterward — an unconditional exit at this point would kill the dev
  // server the instant it finished booting, a real regression, not a hypothetical one. Only a
  // command that explicitly called `requestForceExit()` (today: `space build`, working around a
  // real native-addon hang) forces the process closed here.
  if (wasForceExitRequested()) Deno.exit(0)
} catch (error) {
  // Deliberately raw `console.error`, not the `@zanix/logger` module: this catch exists
  // specifically for failures while `./src/cli.ts` (which sets up that very logger) is loading —
  // depending on it here would defeat the whole point of this fallback.
  // deno-lint-ignore deno-zanix-plugin/no-znx-console
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  Deno.exit(1)
}
