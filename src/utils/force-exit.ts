/**
 * A one-shot command (e.g. `space build`) genuinely finishes all its own work, but the OS process
 * can still fail to exit on its own — true for `space build`: a native npm addon it loads
 * (Rolldown's/Tailwind's own Rust bindings, `sharp`) can leave a background thread pool registered
 * against Deno's event loop past the point this command's own logical work (and its own success
 * log line) is done.
 *
 * `mod.ts` (the real CLI entrypoint) force-exits after `cli.parse()` resolves — but ONLY when a
 * command explicitly calls {@linkcode requestForceExit} first, right before it would otherwise
 * return. This is deliberately OPT-IN, per command, rather than a blanket "exit whenever an action
 * returns" rule: a long-running command (`space dev`) also returns from its own action as soon as
 * `bootstrapServers()` resolves — the server itself is what then keeps the process alive, purely
 * because Deno's own event loop still has an open listener registered, not because the action's
 * own promise stays unresolved. A blanket rule at `mod.ts` would force-exit `space dev` the
 * instant it finishes booting, killing the very server it just started — a real
 * regression, not a hypothetical one.
 *
 * Also what keeps this safe for a command's own test suite, which invokes its action handler
 * directly, in-process (`settings.actionHandler(...)`), bypassing `mod.ts` entirely: setting this
 * flag is inert everywhere except `mod.ts`'s own top-level code, so a test never sees `Deno.exit()`
 * called on its behalf.
 *
 * @module
 */

let requested = false

/** Call once, right before a one-shot command's own action would otherwise return successfully —
 * never on a failure path (an uncaught throw already exits non-zero on its own, via `mod.ts`'s
 * catch block or `Commander`'s own error handler, and must never be masked behind a forced `0`). */
export function requestForceExit(): void {
  requested = true
}

/** Read once, by `mod.ts` itself, immediately after `cli.parse()` resolves. */
export function wasForceExitRequested(): boolean {
  return requested
}
