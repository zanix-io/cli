/**
 * Drift Watch (§7.2 of `engineering.md`'s Generator API Drift Strategy) — regenerates every
 * `zanix new` project type plus a representative `zanix generate` variant matrix, rewrites each
 * generated project's `@zanix/*` imports to the REAL latest published JSR version (not `cli`'s own
 * pinned range in `ZANIX_DEPENDENCY_VERSIONS`), and runs `deno check` against each. A failure here
 * means an upstream Zanix package changed in a way that broke generation, or one of its declared
 * dependencies isn't resolvable on JSR right now, not that `cli` itself regressed. Never blocks
 * anything — meant to run on a schedule/on push, informational only (see
 * `.github/workflows/drift-watch.yml`); this script's own exit code is only there to make that CI
 * step show red, nothing depends on it.
 *
 * The `--type`/`--slot`/`--cron`/`--field`/etc. variant matrix below is deliberately a *curated*
 * set, not a fully generic derivation — `--type` for `handler` genuinely is a closed enum
 * (`HANDLER_TYPES`, imported directly from its own real source below, so it can't silently drift
 * from what the generator actually supports); `--slot`/`--field` accept open-ended strings
 * (`cache:<any subtype>`, arbitrary field specs) with no closed set to derive from, so the
 * variants tested here are chosen to exercise every distinct code path each generator has, not to
 * be exhaustive over an infinite input space.
 *
 * Run locally: `deno run -A scripts/drift-watch.ts`
 */

import { ZANIX_DEPENDENCY_VERSIONS } from '../src/utils/config/dependencies.ts'
import { HANDLER_TYPES } from '../src/commands/generate/handler/command.ts'
import { MIDDLEWARE_TYPES } from '../src/commands/generate/middleware/command.ts'
import { GLOBAL_MIDDLEWARE_TYPES } from '../src/commands/generate/globalmiddleware/command.ts'
import { collectTsFiles } from '../src/utils/verify.ts'
import { getTemporaryFolder } from '@zanix/helpers'
import logger from '@zanix/utils/logger'

const CLI_ENTRYPOINT = new URL('../mod.ts', import.meta.url).pathname

/** One `deno check` result for a single generated project/variant group — `name` identifies it in
 * the final report, `output` is the raw combined stdout/stderr when `success` is `false`. */
export type CheckResult = { name: string; success: boolean; output: string }

/** Exported for `scripts/drift-watch.test.ts` — a thin `Deno.Command` wrapper, cheap to cover
 * directly with real (non-network) subprocesses. */
export async function run(
  args: string[],
  cwd?: string,
): Promise<{ success: boolean; output: string }> {
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  })
  const { success, stdout, stderr } = await command.output()
  const output = new TextDecoder().decode(stdout) +
    new TextDecoder().decode(stderr)
  return { success, output }
}

/** Exported for `scripts/drift-watch.test.ts` — the one piece of this script's logic worth real
 * unit coverage; the rest is live orchestration against real JSR data and real subprocesses,
 * exercised by `.github/workflows/drift-watch.yml`'s own scheduled/on-push runs instead. */
export function parseSpecifier(
  specifier: string,
): { pkg: string; subpath: string } {
  const match = specifier.match(/^jsr:(@[^/]+\/[^@]+)@[^/]+(\/.*)?$/)
  if (!match) throw new Error(`Cannot parse specifier: ${specifier}`)
  return { pkg: match[1], subpath: match[2] ?? '' }
}

const latestVersionCache = new Map<string, string | null>()

/** Exported for `scripts/drift-watch.test.ts` — stubbing global `fetch` covers every branch
 * without a real network call. The one live network call this script makes per distinct package
 * — cached so the same package (e.g. `@zanix/utils`, aliased into by both `@zanix/validator` and
 * `@zanix/types`) is only ever fetched once per run regardless of how many generated projects
 * reference it. */
export async function fetchLatestVersion(pkg: string): Promise<void> {
  if (latestVersionCache.has(pkg)) return

  try {
    const res = await fetch(`https://jsr.io/${pkg}/meta.json`)
    latestVersionCache.set(
      pkg,
      res.ok ? ((await res.json()).latest ?? null) : null,
    )
  } catch {
    latestVersionCache.set(pkg, null)
  }
}

/**
 * Rewrites a generated project's `deno.json`, replacing every known `@zanix/*` import with the
 * REAL latest published version instead of `cli`'s own pinned range — this is what actually makes
 * Drift Watch test against "what's live on JSR right now," not just what `cli` already knows
 * about. Leaves an entry untouched (still on `cli`'s pinned range) if its package can't be
 * resolved at all — nothing this rewrite can do either way for a `@zanix/*` package that isn't
 * resolvable on JSR at the moment it runs.
 *
 * Exported for `scripts/drift-watch.test.ts` — real temp-dir I/O, with only `fetchLatestVersion`'s
 * own `fetch` stubbed, so no test here depends on a real network call.
 */
export async function rewriteToLatestVersions(root: string): Promise<void> {
  const configPath = `${root}/deno.json`
  // deno-lint-ignore no-explicit-any
  const config: any = JSON.parse(await Deno.readTextFile(configPath))
  const imports: Record<string, string> = config.imports ?? {}

  const parsed = Object.fromEntries(
    Object.keys(imports)
      .filter((key) => key in ZANIX_DEPENDENCY_VERSIONS)
      .map((key) => [key, parseSpecifier(imports[key])]),
  )
  const uniquePkgs = new Set(Object.values(parsed).map(({ pkg }) => pkg))
  await Promise.all([...uniquePkgs].map(fetchLatestVersion))

  for (const [key, { pkg, subpath }] of Object.entries(parsed)) {
    const latest = latestVersionCache.get(pkg)
    if (latest) imports[key] = `jsr:${pkg}@${latest}${subpath}`
  }

  config.imports = imports
  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2))
}

/** Exported for `scripts/drift-watch.test.ts` — the "no .ts/.tsx files" short-circuit and the
 * `deno check` dispatch (via `run`, stubbable through `Deno.Command`) are both cheap to cover
 * directly. */
export async function checkProject(name: string, root: string): Promise<CheckResult> {
  await rewriteToLatestVersions(root)

  const files = collectTsFiles(root)
  if (files.length === 0) {
    return { name, success: true, output: '(no .ts/.tsx files)' }
  }

  // `--min-dep-age 0` disables Deno's own client-side "minimum dependency age" policy (a 24h
  // default guard against installing a just-published version) — without it, a generated project
  // citing a package's own just-published latest version (which its template always does) fails
  // this check with a false negative for ~24h after every release of that package, indistinguishable
  // from a real drift/breaking-change failure without reading the raw stderr.
  const { success, output } = await run(
    ['deno', 'check', ...files, '--min-dep-age', '0'],
    root,
  )
  return { name, success, output }
}

/**
 * `extraArgs` (e.g. `['--icons']`) lands between the project `type` and `--no-prepare` — same
 * flags-before-the-final-positional shape {@linkcode generate} already uses for its own trailing
 * `root`. Defaults to none: every `newProject` call site except the `space` variants block below
 * still just wants a plain scaffold.
 *
 * Exported for `scripts/drift-watch.test.ts` — stubbing `Deno.Command` (the same seam `run` already
 * goes through) covers the real argument shape and the temp-dir lifecycle without spawning this CLI
 * for real.
 */
export async function newProject(type: string, extraArgs: string[] = []): Promise<string> {
  const root = await Deno.makeTempDir({
    dir: getTemporaryFolder(import.meta.url),
    prefix: `drift-watch-${type}-`,
  })
  await run([
    'deno',
    'run',
    '-A',
    CLI_ENTRYPOINT,
    'new',
    type,
    ...extraArgs,
    '--no-prepare',
    root,
  ])
  return root
}

/** Exported for `scripts/drift-watch.test.ts` — same `Deno.Command`-stubbing seam as `newProject`. */
export async function generate(root: string, args: string[]): Promise<void> {
  await run(['deno', 'run', '-A', CLI_ENTRYPOINT, 'generate', ...args, root])
}

/**
 * Exported for `scripts/drift-watch.test.ts` — every real subprocess this orchestrates goes through
 * `run`/`Deno.Command` (via `newProject`/`generate`/`checkProject`), so stubbing that one seam plus
 * `Deno.exit` covers the full success/failure reporting path and the temp-dir cleanup without a real
 * live run against JSR/`deno check`.
 */
export async function main() {
  const results: CheckResult[] = []
  const cleanup: string[] = []

  try {
    // --- `zanix new`: every project type, standalone — independent temp dirs, safe in parallel ---
    const newResults = await Promise.all(
      ['library', 'app', 'space', 'server', 'spacecraft'].map(async (type) => {
        const root = await newProject(type)
        cleanup.push(root)
        return checkProject(`new ${type}`, root)
      }),
    )
    results.push(...newResults)

    // --- `zanix generate`: backend variants, against a fresh `server` project ---
    const serverRoot = await newProject('server')
    cleanup.push(serverRoot)

    // Sequential on purpose: every one of these targets the SAME project's shared `deno.json`
    // (`ensureZanixDependency`'s own read-modify-write) — running them concurrently would race on
    // that file, same reasoning as `ensureServerScaffoldSideEffects`'s own sequential loop.
    for (const type of Object.keys(HANDLER_TYPES)) {
      // deno-lint-ignore no-await-in-loop
      await generate(serverRoot, [
        'handler',
        `drift-handler-${type}`,
        '--type',
        type,
      ])
    }
    await generate(serverRoot, ['connector', 'drift-connector-generic'])
    await generate(serverRoot, [
      'connector',
      'drift-connector-db',
      '--slot',
      'database',
    ])
    await generate(serverRoot, [
      'connector',
      'drift-connector-cache',
      '--slot',
      'cache:redis',
    ])
    await generate(serverRoot, ['interactor', 'drift-interactor'])
    await generate(serverRoot, ['job', 'drift-job-ondemand'])
    await generate(serverRoot, [
      'job',
      'drift-job-cron',
      '--cron',
      '0 0 * * * *',
    ])
    await generate(serverRoot, ['repository', 'drift-repository'])
    await generate(serverRoot, ['seeder', 'drift-repository'])
    await generate(serverRoot, ['subscriber', 'drift-subscriber'])
    for (const kind of Object.keys(MIDDLEWARE_TYPES)) {
      // deno-lint-ignore no-await-in-loop
      await generate(serverRoot, [
        'middleware',
        `drift-middleware-${kind}`,
        '--kind',
        kind,
      ])
    }
    for (const kind of Object.keys(GLOBAL_MIDDLEWARE_TYPES)) {
      // deno-lint-ignore no-await-in-loop
      await generate(serverRoot, [
        'globalmiddleware',
        `drift-globalmiddleware-${kind}`,
        '--kind',
        kind,
      ])
    }
    await generate(serverRoot, [
      'rto',
      'drift-rto',
      '--field',
      'name:string',
      '--field',
      'age:number',
      '--field',
      'ownerId:objectId',
      '--field',
      'grantedBy:permission',
    ])
    await generate(serverRoot, [
      'dlqprocessor',
      'drift-dlq',
      '--process-type',
      'drift.process',
      '--schedule',
      '0,30 * * * * *',
    ])

    results.push(await checkProject('generate (backend variants)', serverRoot))

    // --- `zanix generate`: space variants, against a fresh `space --icons` project ---
    // `--icons` is the ONLY path that ever pulls in `@zanix/space-ui` (`ensureSpaceUiDependency`,
    // `commands/new/lib/tree/projects/space-icons.ts`) — a `zanix new space` with no flags never
    // declares that dependency at all, so exercising it here is the only way Drift Watch ever
    // checks `@zanix/space-ui`'s real published API (e.g. `CatalogIcon`/`CatalogIconProps`)
    // against the generated `catalog-icon.ts` wrapper that imports it.
    const spaceRoot = await newProject('space', ['--icons'])
    cleanup.push(spaceRoot)

    await generate(spaceRoot, ['comet', 'DriftCounter'])
    await generate(spaceRoot, ['component', 'DriftCard'])
    await generate(spaceRoot, ['page', 'drift-page'])
    await generate(spaceRoot, ['layout', 'drift-layout'])
    // `interactor` also runs in a plain `space` project now (a `space` app consuming a remote,
    // typed Zanix API needs one too), landing in its own per-domain folder rather than `space`'s
    // other artifacts' shared subfolders — exercises
    // the same `@zanix/server` import a backend project gets, but added on demand via
    // `ensureZanixDependency` rather than present in the fresh scaffold already.
    await generate(spaceRoot, ['interactor', 'drift-triggers'])

    results.push(await checkProject('generate (space variants, --icons)', spaceRoot))
  } finally {
    await Promise.all(
      cleanup.map((dir) => Deno.remove(dir, { recursive: true }).catch(() => {})),
    )
  }

  logger.info('Drift Watch results:')
  let anyFailed = false
  for (const result of results) {
    const icon = result.success ? '✅' : '❌'
    if (result.success) {
      logger.info(`${icon} ${result.name}`)
      continue
    }
    anyFailed = true
    logger.warn(`${icon} ${result.name}\n${result.output}`)
  }

  if (anyFailed) {
    logger.warn(
      'One or more checks failed against currently published dependency versions. This is ' +
        'informational — see each failure above for whether it traces to an upstream breaking ' +
        "change or a package that hasn't published yet.",
    )
    Deno.exit(1)
  }

  logger.info(
    'Everything compiles cleanly against currently published dependency versions.',
  )
}

// Guarded so `drift-watch.test.ts` can import `parseSpecifier` (and every other function above,
// including `main` itself) for unit coverage without also triggering a full live run as an import
// side effect. This `true` branch stays outside unit coverage on purpose: reaching it for real means
// spawning this file as its own child `deno run` process, which crosses a process boundary no stub
// in this test file can follow — `Deno.Command`/`fetch` would be real again, making it the exact
// same live run (real subprocesses, real JSR network calls, real `deno check`, `Deno.exit(1)`)
// `.github/workflows/drift-watch.yml` already exercises on every push/schedule. Not worth forcing
// with a test-only seam when the real thing already runs on its own schedule.
if (import.meta.main) {
  await main()
}
