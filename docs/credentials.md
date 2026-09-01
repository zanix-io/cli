# `zanix credentials` — credential-generation tooling

`zanix credentials <mesh|password-hash>` is a parent command for
credential-generation tooling — same shape as [`zanix space`](./space.md)'s
own parent/subcommand pattern. `mesh` (around `@zanix/auth`'s
service-credential exchange, `createServiceAssertion`/
`exchangeServiceCredential`) and `password-hash` (a single unidirectional
password hash, `@zanix/helpers`'s `generateHash()`) are its subcommands; a
future one would register the same way. Running `zanix credentials` with no
subcommand errors out.

```bash
zanix credentials mesh <id1> <id2> [...more-ids]
zanix credentials password-hash [password]
```

## `mesh`

Generates a real, matched set of RSA keypairs for N cooperating service
identities, printing ready-to-paste, correctly-cross-referenced `.env` blocks
— closing a real gap this ecosystem has no other tooling for: setting up
service-to-service auth for a multi-identity mesh (e.g. a business service, an
admin hub, and a remote-templates consumer) otherwise requires hand-generating
and hand-cross-referencing `JWK_PRI_<id>`/`JWK_PUB_<id>` pairs across N
separate `.env` files, with zero tooling and zero cross-check.

```bash
zanix credentials mesh billing zanix-admin templates
```

**Local-dev/first-integration-setup convenience only — never a production
secrets-provisioning path.** Real production secrets belong to
infra-as-code/secrets-manager tooling. This command **never writes a file** —
the same boundary every `zanix new`/`zanix generate` scaffold already holds
for `.env` itself (a freshly scaffolded project's `dev` task reads `.env` via
`--env-file`, but nothing in this CLI ever creates one) — it only prints text
to stdout for the operator to paste into each identity's own real secrets
store by hand.

### Requires at least 2 identities

A "mesh" of fewer than 2 identities has nothing to cross-reference —
`JWK_PUB_<id>`/`SERVICE_PERMISSIONS_<id>` only exist to let one identity
verify ANOTHER's assertions:

```bash
$ zanix credentials mesh solo
error: 'zanix credentials mesh' needs at least 2 cooperating identities, got 1 — a mesh of fewer
than 2 has nothing to cross-reference. Example: 'zanix credentials mesh billing zanix-admin'.
```

Every identity must also be unique, and match `[A-Za-z0-9_-]+` (the same
shape a real `serviceId` already takes elsewhere in this ecosystem, e.g.
`zanix-admin`) — anything else would break the resulting `.env` line's own
shape once pasted.

### What gets printed, per identity

For each identity `<id>` in the mesh, in the order given:

- `JWK_PRI_<id>` — a real, freshly generated RSA private key
  (`generateRSAKeys()` from `@zanix/helpers`, base64-encoded PKCS#8), labeled
  to paste **only** on `<id>`'s own process — never shared.
- `JWK_PUB_<id>` — the matching public key, printed **once per OTHER identity
  in the mesh**, each repetition individually labeled with which other
  process it belongs on. A mesh of N identities means each public key appears
  N − 1 times across the whole output, once for every process that needs to
  verify that identity's assertions.
- `SERVICE_PERMISSIONS_<id>=` — an empty placeholder, printed once. **Never
  guessed.** Per `@zanix/auth`'s own service-credential exchange, granted
  permissions come only from this operator-configured env var, never from
  anything a caller's own assertion requests — there is no safe default this
  command (or any tool) could fill in on the operator's behalf. Fill it in
  yourself on every process where the matching `JWK_PUB_<id>` above is
  pasted.

### Example

```bash
$ zanix credentials mesh billing zanix-admin
# ==================== billing ====================
# Paste this ONLY on "billing"'s own process — never share it.
JWK_PRI_billing=<base64 private key>

# Paste this on "zanix-admin"'s own process — it needs to verify "billing"'s assertions.
JWK_PUB_billing=<base64 public key>

# Operator policy decision — no tool can safely infer this. Fill in the permissions "billing"
# is granted, on every process where "JWK_PUB_billing" above is pasted (see
# @zanix/auth's service-credential exchange: granted permissions come only from this env
# var, never from the caller's own assertion).
SERVICE_PERMISSIONS_billing=

# ==================== zanix-admin ====================
# Paste this ONLY on "zanix-admin"'s own process — never share it.
JWK_PRI_zanix-admin=<base64 private key>

# Paste this on "billing"'s own process — it needs to verify "zanix-admin"'s assertions.
JWK_PUB_zanix-admin=<base64 public key>

# Operator policy decision — no tool can safely infer this. Fill in the permissions "zanix-admin"
# is granted, on every process where "JWK_PUB_zanix-admin" above is pasted (see
# @zanix/auth's service-credential exchange: granted permissions come only from this env
# var, never from the caller's own assertion).
SERVICE_PERMISSIONS_zanix-admin=
```

For a mesh of 3+ identities (e.g. a business service, an admin hub, and a
remote-templates consumer), each identity's own block additionally prints its
`JWK_PUB_<id>` once for every OTHER identity — see `@zanix/auth`'s own
[service-credential documentation](https://jsr.io/@zanix/auth) for the full
exchange flow these env vars feed into, and for the `_<keyId>`-suffixed
rotation form (not generated by this command — a mesh generates a fresh,
non-rotated keypair per identity; wire up rotation by hand once a real
`SERVICE_KEY_ID` is in play).

## `password-hash`

Hashes a password via `@zanix/helpers`'s `generateHash()` (a salted,
iterated-SHA unidirectional hash — the original password can never be
recovered from the result), printing a single-quoted, ready-to-paste `.env`
value. Never writes a file, and never prints the plaintext password itself
anywhere in its own output.

```bash
zanix credentials password-hash 'correct horse battery staple'
zanix credentials password-hash --var-name CONSOLE_OPERATOR_PASSWORD_HASH 'correct horse battery staple'
zanix credentials password-hash   # prompts interactively (hidden input) instead
```

### Closes a real Deno `--env-file` footgun

`generateHash()`'s own output format is `<salt-hex>$<hash-base64>` — a real,
literal `$` character, not incidental. Deno's own `--env-file` parsing does
dotenv-style `$VAR`/`${VAR}` expansion for an **unquoted** value, silently
truncating everything from that `$` onward and leaving a shorter, broken hash
with no error at all — a login built on that hash then fails for a reason
that looks nothing like "the env var is malformed". This command always
prints the value already wrapped in single quotes for exactly this reason —
copy-paste it as shown, never strip the quotes.

### `[password]` — argument or interactive prompt

Passing the password as a positional argument works, but leaves it visible
in shell history and any process listing for as long as either persists.
Omit it instead to be prompted interactively (`promptSecret`, `@std/cli`) —
hidden input, typed twice to catch a typo before it becomes an unrecoverable
"why doesn't this password validate" mystery later. The interactive prompt
needs a real terminal on stdin; running this command with no argument
outside one (piped input, a non-interactive CI shell) errors out, pointing
back at the argument form instead.

### `--level <level>` — MUST match the consuming project's own `validateHash()` call

One of `low`, `medium`, `medium-high`, `high` (`generateHash()`'s own
`EncryptionLevel`), default `medium` — the same default every current real
consumer's own `validateHash()` call uses (e.g. `console`'s
`login.interactor.ts`). A hash generated at one level and validated at
another never matches; if the project you're generating this for calls
`validateHash()` with an explicit, non-default level, pass the matching
`--level` here too.

### `--var-name <name>` — a ready `.env` line, not just the value

```bash
$ zanix credentials password-hash --var-name CONSOLE_OPERATOR_PASSWORD_HASH 'correct horse battery staple'
CONSOLE_OPERATOR_PASSWORD_HASH='018eb66bae67ed8d283356b5ab010eb5$8LPESZvz1E6CG4wkYy9ggTpJh0T93j51V+HyuZPw3ks='
```

Without it, only the bare single-quoted value prints — paste it after your
own `VAR_NAME=` by hand.

## See also

- [`space`](./space.md) — another parent/subcommand-shaped top-level command
  with the same registration pattern.
