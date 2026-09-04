import type { DiscoveredRoute } from 'commands/generate/openapi/spec-builder.ts'

import { resolve } from '@std/path'

/**
 * Prefixes {@linkcode DISCOVERY_SCRIPT}'s own, final `console.log` — the one and only line
 * `discoverRoutes` actually wants to parse as JSON. Real-world confirmation this is needed, not
 * defensive-for-its-own-sake: a resolved `@zanix/datamaster` pulls in `jsr:@db/sqlite`
 * (`denodrivers/sqlite3`), which downloads its native binary lazily, on first use with no cached
 * copy yet (a fresh CI runner, always — never a locally-run repro with a warm `DENO_DIR`), and
 * prints that download's progress straight to **stdout** via `console.log`, not `stderr` the way
 * every other Deno/dependency diagnostic in this same subprocess does — confirmed by direct repro
 * against a genuinely cold `DENO_DIR`. That noise lands on the SAME piped stdout `discoverRoutes`
 * reads below, ahead of the script's own JSON line, so a plain `JSON.parse(stdoutText)` broke with
 * a raw `Unexpected token 'Downl'...` the moment it ran anywhere without that binary pre-cached.
 * Splitting on this marker and keeping only what follows it is immune to that (or any other
 * dependency's own stdout noise) without needing to know in advance what a given dependency might
 * print — the marker only ever appears once, right before the payload, emitted by this script's
 * own last statement.
 */
export const STDOUT_PAYLOAD_MARKER = '___ZNX_OPENAPI_ROUTES_JSON___'

/**
 * The script `discoverRoutes` writes into the target project and runs there via `deno run` — never
 * imported in-process by `cli` itself. Native ECMAScript decorator metadata (`Symbol.metadata`,
 * which both `@zanix/validator`'s field decorators and `@zanix/server`'s route decorators key their
 * registries off) is only shared between two pieces of code that resolve the exact same
 * `@zanix/utils` module instance — `cli` and the target project are two separate module graphs, so
 * introspecting the target project's own decorated classes has to run INSIDE a process rooted at
 * that project, not by importing its files from here (same reasoning as `verify.ts`'s own
 * `deno check` subprocess, just running instead of checking).
 *
 * Four preconditions are checked explicitly, each with its own sentinel line printed to stderr
 * before a non-zero exit, rather than letting a raw `TypeError`/`SyntaxError` surface: the resolved
 * `@zanix/core` may predate `Zanix.compose`, the resolved `@zanix/validator` (an alias into
 * `@zanix/utils`) may predate `classMetadata`, the resolved `@zanix/server`'s own `ProgramModule`
 * may not expose `.routes` on its public surface yet, and — only when admin discovery was actually
 * requested — the resolved `@zanix/core` may predate `Zanix.compose`'s own `{ admin: true }` option
 * (see the `includeAdmin` block below). `discoverRoutes` below turns whichever one trips into one
 * clear, actionable error.
 *
 * `@zanix/validator` is imported as a namespace (`import * as`), not a named `{ classMetadata }`
 * import: a named import of an export that doesn't exist on the resolved module fails at
 * module-link time, before any of this script's own code runs at all — a namespace import defers
 * that to a plain, checkable `undefined` property access instead.
 *
 * `Zanix.compose(rootDir, { admin: true })` deliberately isn't fed an extra positional argument
 * unconditionally — when admin discovery isn't requested, this calls `Zanix.compose(rootDir)` with
 * the exact same single argument as before, so the byte-for-byte-unchanged default `compose()`
 * behavior that option's own contract guarantees is never put at risk by this script's own shape.
 * Calling a resolved `@zanix/core` whose OWN declared `compose` signature still predates this
 * option with a second argument anyway is harmless at runtime — `deno run` (unlike `deno check`)
 * doesn't type-check by default, and a plain JS function silently ignores an extra argument — so no
 * new sentinel is needed for "the resolved compose doesn't know about a second argument at all."
 * What IS checked below (`ZANIX_COMPOSE_ADMIN_UNSUPPORTED`) is the different, real gap: a resolved
 * `compose` that predates the option would silently just never register any `'admin'`-Application
 * route, which would otherwise look identical to "this project genuinely has no admin routes" —
 * `@zanix/admin`'s own `/admin/service-token` is registered unconditionally whenever `{ admin: true
 * }` is actually honored (verified against `@zanix/admin`'s real `defineAdminMetadata`), so its
 * absence is a reliable signal to surface as a clear upgrade error instead of a silent no-op.
 *
 * `serializeRto` resolves a route's `Body`/`Params`/`Search` RTOs via `classMetadata()` before
 * anything crosses the `JSON.stringify` boundary below — a live class constructor never survives
 * serialization. A `ValidateNested(NestedRTO)` field's own `classMetadata()` entry carries
 * `args: [NestedRTO]`, the real, live `NestedRTO` constructor (see `@zanix/utils`'s own
 * `ValidateNested`/`classMetadata` doc) — `resolveNestedRtoFields`/`resolveNestedDecoratorEntry`
 * walk every field (and, for a field stacking `ValidateNested` alongside another decorator, every
 * entry in its own `decorators` array — `classMetadata()`'s per-field record of every stacked
 * decorator) replacing that live constructor with its OWN resolved `classMetadata()` output,
 * in place, recursively, so a nested RTO's own nested RTOs resolve too. `MAX_NESTED_RTO_DEPTH`
 * bounds that recursion — a circular RTO reference (deliberate or accidental) would otherwise
 * recurse without end; past the bound, the deepest field's own nested constructor is left
 * unresolved, which `JSON.stringify` then simply drops rather than crashing on.
 */
const DISCOVERY_SCRIPT = `
import Zanix from '@zanix/core'
import { ProgramModule } from '@zanix/server'
import * as znxValidator from '@zanix/validator'

const classMetadata = znxValidator.classMetadata
const rootDir = Deno.args[0] || '.'
const includeAdmin = Deno.args[1] === '1'

if (typeof Zanix.compose !== 'function') {
  console.error('ZANIX_COMPOSE_UNSUPPORTED')
  Deno.exit(1)
}
if (typeof classMetadata !== 'function') {
  console.error('ZANIX_CLASS_METADATA_UNSUPPORTED')
  Deno.exit(1)
}

await Zanix.compose(rootDir, includeAdmin ? { admin: true } : undefined)

if (!ProgramModule.routes || typeof ProgramModule.routes.getRoutes !== 'function') {
  console.error('ZANIX_PROGRAM_ROUTES_UNSUPPORTED')
  Deno.exit(1)
}

const routes = ProgramModule.routes.getRoutes('rest') ?? {}

if (includeAdmin) {
  const hasAdminServiceToken = Object.values(routes).some((route) =>
    route.application === 'admin' &&
    route.path === '/admin/service-token' &&
    route.httpMethod === 'POST'
  )
  if (!hasAdminServiceToken) {
    console.error('ZANIX_COMPOSE_ADMIN_UNSUPPORTED')
    Deno.exit(1)
  }
}

// Bounds ValidateNested's own recursive resolution below — a circular RTO reference would
// otherwise recurse without end; a real nesting chain this deep would already be a design smell.
const MAX_NESTED_RTO_DEPTH = 8

function resolveNestedDecoratorEntry(entry, depth) {
  if (entry.decorator !== 'ValidateNested' || typeof entry.args[0] !== 'function') return
  const nestedFields = classMetadata(entry.args[0])
  if (depth < MAX_NESTED_RTO_DEPTH) resolveNestedRtoFields(nestedFields, depth + 1)
  entry.args[0] = nestedFields
}

function resolveNestedRtoFields(fields, depth) {
  for (const field of Object.values(fields)) {
    resolveNestedDecoratorEntry(field, depth)
    if (field.decorators) {
      for (const entry of field.decorators) resolveNestedDecoratorEntry(entry, depth)
    }
  }
  return fields
}

function serializeRto(rto) {
  if (!rto) return undefined
  const result = {}
  if (rto.Body) result.Body = resolveNestedRtoFields(classMetadata(rto.Body), 0)
  if (rto.Params) result.Params = resolveNestedRtoFields(classMetadata(rto.Params), 0)
  if (rto.Search) result.Search = resolveNestedRtoFields(classMetadata(rto.Search), 0)
  return result
}

const serialized = Object.values(routes).map((route) => ({
  httpMethod: route.httpMethod,
  path: route.path,
  application: route.application,
  rto: serializeRto(route.rto),
}))

console.log('${STDOUT_PAYLOAD_MARKER}' + JSON.stringify(serialized))
`

/** Every sentinel {@linkcode DISCOVERY_SCRIPT} can print to stderr, mapped to the clear, actionable
 * error `discoverRoutes` throws instead of surfacing the raw subprocess failure. */
const SENTINEL_ERRORS: Record<string, string> = {
  ZANIX_COMPOSE_UNSUPPORTED:
    "This project's @zanix/core version doesn't support Zanix.compose() (needed for openapi " +
    'generation) — upgrade @zanix/core.',
  ZANIX_CLASS_METADATA_UNSUPPORTED:
    "This project's @zanix/validator (@zanix/utils) version doesn't support classMetadata() " +
    '(needed for openapi generation) — upgrade @zanix/utils.',
  ZANIX_PROGRAM_ROUTES_UNSUPPORTED:
    "This project's @zanix/server version doesn't expose ProgramModule.routes (needed for " +
    'openapi generation) — upgrade @zanix/server.',
  ZANIX_COMPOSE_ADMIN_UNSUPPORTED:
    "This project's @zanix/core version doesn't support Zanix.compose()'s { admin: true } option " +
    '(needed for --include-admin) — upgrade @zanix/core.',
}

/**
 * Runs {@linkcode DISCOVERY_SCRIPT} inside a `deno run` subprocess rooted at `root` (the target
 * project), returning every REST route it discovers with its declared `rto` (if any) already
 * resolved to plain field metadata — no live class constructor ever crosses the process boundary.
 *
 * The script is written to a real temporary `.ts` file INSIDE `root` (not passed by path from
 * outside it, and not piped via stdin) — Deno's bare-specifier import resolution (`@zanix/core`,
 * `@zanix/server`, `@zanix/validator`) depends on the entry MODULE's own location for its nearest
 * `deno.json`/import map, not on the spawned process's `cwd` alone (confirmed empirically: an
 * otherwise identical script run from outside `root`, even with `cwd: root` set, fails to resolve
 * `root`'s own import map at all) — unlike `verify.ts`'s own `deno check`, which only ever checks
 * files that already live inside the generated project. The temp file is removed in a `finally`,
 * whether discovery succeeds or fails.
 *
 * @param root - The target project's own root folder.
 * @param rootDir - Forwarded to `Zanix.compose` as its own handler-discovery scope (same option
 * shape as `SetupOptions.rootDir`). Defaults to `'.'`, matching `zanix new server`'s own scaffold
 * (`Zanix.start()`, called with no explicit `rootDir` at all).
 * @param includeAdmin - Forwards `{ admin: true }` as `Zanix.compose`'s own second argument, so
 * `@zanix/admin`'s built-in `'admin'`-Application routes (`/admin/service-token`, and — when the
 * target project's own env vars enable them — `/admin/triggers`/`/admin/templates`) are discovered
 * alongside the project's regular routes. Defaults to `false`, matching `Zanix.compose`'s (and
 * `Zanix.start`'s) own `admin` option default — admin routes stay invisible unless explicitly asked
 * for, the same opt-in-only shape the rest of the Zanix ecosystem already gives that surface.
 * @throws {Error} When any of the four preconditions above isn't met, or the subprocess fails for
 * any other reason (module resolution, a real compose-time error in the target project's own
 * handlers) — the raw stderr is appended for diagnosis either way.
 */
export async function discoverRoutes(
  root: string,
  rootDir?: string,
  includeAdmin?: boolean,
): Promise<DiscoveredRoute[]> {
  root = resolve(root)
  const scriptPath = await Deno.makeTempFile({ dir: root, suffix: '.ts' })

  try {
    await Deno.writeTextFile(scriptPath, DISCOVERY_SCRIPT)

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        '--min-dep-age',
        '0',
        scriptPath,
        rootDir ?? '.',
        includeAdmin ? '1' : '0',
      ],
      cwd: root,
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, stdout, stderr } = await command.output()
    const stderrText = new TextDecoder().decode(stderr)

    if (!success) {
      for (const [sentinel, message] of Object.entries(SENTINEL_ERRORS)) {
        if (stderrText.includes(sentinel)) throw new Error(message)
      }
      throw new Error(`Route discovery failed:\n${stderrText}`)
    }

    const stdoutText = new TextDecoder().decode(stdout)
    // `lastIndexOf`, not `indexOf` — the marker is only ever written once, by the script's own
    // final statement, but taking the LAST occurrence (rather than assuming the first) stays
    // correct even if some dependency's own stdout noise happened to echo the marker text itself
    // (it can't, in practice — the marker is a private, single-use constant — but this is free).
    const markerIndex = stdoutText.lastIndexOf(STDOUT_PAYLOAD_MARKER)
    if (markerIndex === -1) {
      throw new Error(`Route discovery produced no output:\n${stdoutText || stderrText}`)
    }
    const payload = stdoutText.slice(markerIndex + STDOUT_PAYLOAD_MARKER.length).trim()
    return payload ? JSON.parse(payload) : []
  } finally {
    await Deno.remove(scriptPath).catch(() => {})
  }
}
