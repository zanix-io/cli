# `zanix check-cycles` command reference

`zanix check-cycles` is the automated check for a real, shipped bug class in
this ecosystem: an intra-package circular import combined with a top-level
side effect that reads a binding still inside that same cycle — the exact
shape that caused a real `ReferenceError: Cannot access 'SmtpClient' before
initialization` in `@zanix/notifications`'s SMTP connector (`defs.ts`'s eager
`registerSmtpConnector()` reading `SmtpClient` mid-cycle from
`connector.ts`/`pool.ts`). Exits non-zero on a confirmed finding, so it's
safe to gate a CI job on.

```bash
zanix check-cycles
```

| Option              | Default | Description                                                                  |
| ------------------- | ------- | ---------------------------------------------------------------------------- |
| `-p, --path <path>` | `'.'`   | The Zanix package root to check. Must have its own `deno.json`/`deno.jsonc`. |

## How it works

Two independent phases, each covering a real, distinct failure mode:

1. **Real import graph.** `deno info --json` resolves the package's real
   intra-package import graph (relative and import-map/alias imports alike —
   a cross-package `@zanix/*` cycle is a different, cross-package concern,
   not this command's job), restricted to files under the checked package's
   own root. Every real `exports` entrypoint in `deno.json(c)` is seeded, not
   just the first one — a package's real activation side effect (an eager
   `registerXConnector()` call) commonly lives behind a subpath entrypoint
   (like `./core`) never reached by importing the package's main `.` export
   alone.
2. **Real cycles.** Tarjan's strongly-connected-components algorithm finds
   every real cycle in that graph — a single pass, no repeated per-node
   reachability checks.
3. **Real side-effect analysis**, only for files actually inside a cycle: a
   real AST pass (via `Deno.lint.runPlugin`) finds a top-level (module-scope)
   statement that executes something — a call, a `new`, a top-level `await`,
   or a `class X extends Y` (a class's `extends` clause evaluates the moment
   the class itself is declared, the same TDZ-risk shape as a top-level call)
   — and, in doing so, reads a binding still imported from another file in
   the same cycle.

A bare cycle with no such statement is reported as clean, not as a finding —
most cycles in this ecosystem are harmless on their own, and flagging every
one would be pure noise. Only the combination (cycle + risky top-level read)
is a real hazard.

## CI wiring

`zanix prepare -g` scaffolds a `Check for circular-import hazards` step
(`deno run -A jsr:@zanix/cli check-cycles`) into `.github/workflows/ci.yml`
— generated for every real project type. `ci.yml` also declares
`workflow_call`, so `'library'`/`'app'`'s ADDITIONAL `.github/workflows/publish.yml`
doesn't duplicate the check or run unrelated to it in parallel: its own
`ci` job invokes `ci.yml` as a reusable workflow, and its `publish` job
declares `needs: ci` — a confirmed `check-cycles` finding fails `ci.yml`'s
job, which blocks `publish.yml`'s `deno test`/`deno publish` from ever
starting. Also wired into the generated `pre-push` Git hook (`deno task
check-cycles`, alongside `check-duplicates`'s own matching task) — a
confirmed finding blocks the push, same as a failing test (override with
`--no-verify`). Deliberately not wired into the `pre-commit` hook — a cycle by
definition spans files that won't all be staged together in a typical
commit, and the `deno info`/AST-pass cost fits a once-per-push/PR cadence far
better than a per-commit local hook. See [`prepare`](./prepare.md) for the
full `-g` scaffolding this is part of.

## Example finding

```
$ zanix check-cycles --path ./packages/notifications
Confirmed intra-package circular-import hazard:
  Cycle: email/defs.ts -> email/connector.ts -> email/pool.ts -> email/defs.ts
  email/defs.ts:12 reads 'SmtpClient', imported from email/connector.ts (same cycle)
```

## Examples

```bash
# Check the current directory (must have its own deno.json/deno.jsonc)
zanix check-cycles

# Check a specific package root, e.g. in a CI job across a monorepo
zanix check-cycles --path ./packages/notifications
```

## See also

- [`build`](./build.md) — another single-leaf, non-generator top-level
  command with the same bare-`Commander` shape.
- [`check-duplicates`](./check-duplicates.md) — another single-leaf,
  non-generator top-level command with the same bare-`Commander` shape,
  checking a different real bug class: a `@zanix/*` package resolved to more
  than one version at once in `deno.lock`.
