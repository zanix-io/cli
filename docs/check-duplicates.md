# `zanix check-duplicates` command reference

`zanix check-duplicates` is the automated check for a real, confirmed bug
class in this ecosystem: a `@zanix/*` package resolved to more than one
distinct version at once in the same `deno.lock`.

This happens when a downstream package (e.g. `@zanix/core`) still pins a
pre-major range (`~0.8.1`) for a dependency an app also pulls directly at a
new major (`^1.0.0`) — since the ranges don't overlap, Deno keeps BOTH
resolved versions live in the lockfile instead of collapsing them into one.
`@zanix/server`'s DI container keys a target by the identity of its own class
reference (a `WeakMap<constructor, key>`), and every `@Provider`/`@Connector`
decorator validates with `instanceof` against a base class — both
identity-based, not name-based. Whichever copy of the duplicated class gets
decorated registers under ITS OWN key; a caller resolving the OTHER copy
finds nothing registered, and the DI container throws
`TypeError: Target is not a constructor` with
`targetName: "'unknown': there is no metadata information"` — a real
incident, not a hypothetical. Exits non-zero on a confirmed finding, so it's
safe to gate a CI job on.

```bash
zanix check-duplicates
```

| Option              | Default | Description                                               |
| ------------------- | ------- | --------------------------------------------------------- |
| `-p, --path <path>` | `'.'`   | The project root to check. Must have its own `deno.lock`. |

## How it works

Pure lockfile inspection, no dependency resolution of its own:

1. Reads `<path>/deno.lock`'s `specifiers` map — every specifier Deno
   resolved in the project (`jsr:@zanix/auth@^1.0.0`,
   `jsr:@zanix/auth@~0.8.1`, ...), mapped to the concrete version each one
   resolved to.
2. Groups those specifiers by `@zanix/*` package name. Only `jsr:@zanix/*`
   specifiers are considered — the whole ecosystem publishes exclusively to
   JSR, and a non-`@zanix` package (`@std/*`, third-party) is out of scope
   for this check (see `dependency-drift`/`ecosystem-maintenance` for that).
3. Any package name that resolves to more than one distinct version is
   reported as a finding, together with the version(s) and which
   specifier(s) resolved to each.

A `deno.lock` where every `@zanix/*` package resolves to exactly one version
is reported as clean.

## CI wiring

`zanix prepare -g` scaffolds a `Check for duplicate '@zanix/*' dependencies`
step (`deno run -A jsr:@zanix/cli check-duplicates`) into
`.github/workflows/ci.yml`, right after the `check-cycles` step — same
`workflow_call` reuse from `publish.yml` described in
[`check-cycles.md`](./check-cycles.md#ci-wiring) applies here too. Also
wired into the generated `pre-push` Git hook (`deno task check-duplicates`,
alongside `check-cycles`'s own matching task) — a confirmed finding blocks
the push, same as a failing test (override with `--no-verify`). Not wired
into the `pre-commit` hook, for the same reason as `check-cycles`: this reads
the project's own `deno.lock`, not the files staged in a given commit — a
once-per-push/PR cadence fits it far better than a per-commit local hook.

## Example finding

```
$ zanix check-duplicates --path ./apps/console
Confirmed '@zanix/*' dependency drift:
@zanix/auth: resolves to 2 distinct versions at once — '0.8.1' (via jsr:@zanix/auth@~0.8.1) and '1.0.0' (via jsr:@zanix/auth@^1.0.0)
```

## Examples

```bash
# Check the current directory (must have its own deno.lock)
zanix check-duplicates

# Check a specific project root, e.g. in a CI job across a monorepo
zanix check-duplicates --path ./apps/console
```

## See also

- [`check-cycles`](./check-cycles.md) — another single-leaf, non-generator
  top-level command with the same bare-`Commander` shape, checking a
  different real bug class.
