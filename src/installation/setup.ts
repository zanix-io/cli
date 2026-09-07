// Copyright 2026 the Zanix authors. All rights reserved. MIT license.

/**
 * The single, cross-platform installer for `@zanix/cli`. Deno is already a hard prerequisite for
 * using `@zanix/cli` at all, so the installer itself is a Deno script — one command, identical on
 * macOS/Linux/Windows.
 *
 * Run via:
 * ```sh
 * deno run -A jsr:@zanix/cli@[version]/setup [version]
 * ```
 * Pinned to the same `[version]` being installed, since a bare `jsr:@zanix/cli/setup` would only
 * resolve against a version that actually declares this export. Installing a version published
 * within the last 24 hours fails before this script ever runs, with Deno's own "minimum
 * dependency age" error — add `--minimum-dependency-age 0` right after `-A` in that case.
 *
 * `--local` mode (`deno run -A ./src/installation/setup.ts --local`, wired to this repo's own
 * `deno task cli:install`) installs THIS checkout instead of a published `jsr:@zanix/cli@version`
 * — the maintainer's own "try my local changes as the real global `zanix` binary" workflow. It's
 * the same script, not a separate one, specifically so the install/smoke-test/lockfile-sync steps
 * a real end-user goes through never drift out of sync with what the maintainer exercises day to
 * day (a real, confirmed gap this replaced: the old standalone `cli:install` task line installed
 * straight from `./mod.ts` and never went through JSR at all, so it could never have caught a bug
 * that only reproduces once THIS module itself loads from a real remote specifier — exactly what
 * broke `check-cycles`'s own `import.meta.url` handling). `fromFileUrl` is safe to use in the
 * `--local` branches below ONLY because `--local` is, by construction, never invoked any other way
 * than as a real local file (there is no "remote local install" — the concept is a contradiction),
 * unlike this package's OWN internal modules, which must never assume `import.meta.url` is
 * `file://` (see `commands/check-cycles/lib/analyze.ts`'s `runHarness` for the real bug that
 * assumption caused).
 */

import { fromFileUrl } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'

const isLocal = Deno.args[0] === '--local'

// Derived from this package's own `deno.jsonc`, not a hardcoded literal — the source of truth
// for what "latest" means stays in one place. `fetch` (not `Deno.readTextFile`) works whether
// `import.meta.url` is a real `file://` checkout or `https://jsr.io/...`. Falls back to a fixed
// literal only if this file is ever invoked outside its own published package layout. Skipped
// entirely in `--local` mode — there is no version to resolve, only this checkout on disk.
const LATEST = isLocal ? undefined : await fetch(new URL('../../deno.jsonc', import.meta.url))
  .then((response) => response.text())
  .then((text) => (parseJsonc(text) as { version: string }).version)
  .catch(() => '2.0.8')
const VERSION = isLocal ? undefined : (Deno.args[0] ?? LATEST)
const BIN_NAME = 'zanix'
const SEPARATOR = '==================================================='

const logo = `
 ______               _
|___  /              (_)
   / /   __ _  _ __   _ __  __
  / /   / _\` || '_ \\ | |\\ \\/ /
./ /___| (_| || | | || | >  <
\\_____/ \\__,_||_| |_||_|/_/\\_\\
`

const colors = {
  blue: (text: string) => `\x1b[0;34m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[0;33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[0;31m${text}\x1b[0m`,
}

function info(message: string): void {
  console.log(`\n${colors.yellow(`info[zanix-installer]`)}: ${message}`)
}

function warn(message: string): void {
  console.log(`\n${colors.yellow(`warn[zanix-installer]`)}: ${message}`)
}

function fail(message: string): never {
  console.log(`\n${colors.red(`error[zanix-installer]`)}: ${message}`)
  Deno.exit(1)
}

/** True when `command`'s own bare name resolves on `PATH` — the cross-platform equivalent of
 * `command -v`/`Get-Command`, checked by actually attempting to spawn it rather than parsing
 * `PATH` by hand (avoids reimplementing platform-specific executable-extension rules, `.exe`/
 * `.cmd`/`.bat` on Windows vs. none on macOS/Linux). */
async function commandExists(command: string): Promise<boolean> {
  try {
    const process = new Deno.Command(command, {
      args: ['--version'],
      stdout: 'null',
      stderr: 'null',
    })
    const { code } = await process.output()
    return code === 0 || code === 1 // some tools exit 1 on --version alone; presence is what matters
  } catch {
    return false
  }
}

/** Runs `command` and returns its combined output — the same capture-then-check-on-failure shape
 * every real failure point in this script uses: quiet on the happy path, only ever printed if the
 * command actually fails. */
async function run(
  command: string,
  args: string[],
): Promise<{ success: boolean; output: string }> {
  const process = new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  })
  const { code, stdout, stderr } = await process.output()
  const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
  return { success: code === 0, output }
}

async function confirm(question: string): Promise<boolean> {
  const answer = prompt(`${colors.yellow(question)} (y/n):`)
  return answer?.toLowerCase() === 'y'
}

// Welcome
console.log(`\n${colors.blue('Welcome to the amazing world of')}:`)
console.log(logo)
console.log(colors.blue("We're about to embark on a wonderful journey together."))
console.log(
  colors.blue('The installation is starting now, so get ready for some great experiences ahead!\n'),
)
console.log(SEPARATOR)

// Check if Zanix is already installed — skipped in `--local` mode, which always force-reinstalls
// (`-f`, added to `installArgs` below) instead of prompting: a maintainer re-running this after
// every local change would otherwise hit a confirmation prompt on every single iteration.
if (!isLocal) {
  if (await commandExists(BIN_NAME)) {
    if (await confirm('Zanix is already installed. Do you want to replace the current version?')) {
      info('Updating...')
      await run('deno', ['uninstall', '-g', BIN_NAME])
    } else {
      fail('Installation will not proceed.')
    }
  } else {
    info('Installing Zanix...')
  }
} else {
  info('Installing Zanix (local checkout)...')
}

// `--local`: this checkout's own `./mod.ts`, a real local file — always, by construction (see
// this file's own top-of-file doc). Otherwise, the published `jsr:@zanix/cli@version` a real
// end-user installs.
const APP = isLocal
  ? fromFileUrl(new URL('../../mod.ts', import.meta.url))
  : `jsr:@zanix/cli@${VERSION}`

// `deno install -g`'s own generated shim runs under a synthetic, install-time config — this
// package's own `deno.jsonc` (and the `imports` map every native `import()` this package performs
// against a bare specifier needs) is never consulted unless `--config` is passed to `deno install`
// itself.
let configArgs: string[] = []
let filteredConfigPath: string | undefined
if (isLocal) {
  // This checkout's own `deno.jsonc`, used AS-IS, unfiltered — unlike the remote branch below,
  // every alias it declares (`typings/`, `shared/`, ...) already resolves correctly against this
  // real, local source tree, so there's nothing to strip.
  configArgs = ['--config', fromFileUrl(new URL('../../deno.jsonc', import.meta.url))]
} else {
  // Fetched fresh for this install and filtered down to genuine scheme-based entries only
  // (`jsr:`/`npm:`/`http(s):`) — this package's own internal local aliases (`typings/`, `shared/`,
  // ...) would resolve against wherever this temp file sits, not this package's real source tree,
  // so they're dropped.
  const configResponse = await fetch(`https://jsr.io/@zanix/cli/${VERSION}/deno.jsonc`).catch(() =>
    null
  )
  if (configResponse?.ok) {
    try {
      const publishedConfig = parseJsonc(await configResponse.text()) as {
        imports?: Record<string, string>
        minimumDependencyAge?: number
        nodeModulesDir?: string
      }
      const imports: Record<string, string> = {}
      for (const [key, value] of Object.entries(publishedConfig.imports ?? {})) {
        if (/^(jsr:|npm:|https?:)/.test(value)) imports[key] = value
      }
      filteredConfigPath = await Deno.makeTempFile({ suffix: '.json' })
      await Deno.writeTextFile(
        filteredConfigPath,
        JSON.stringify(
          {
            minimumDependencyAge: publishedConfig.minimumDependencyAge ?? 0,
            // Deno resolves a running process's own npm dependencies (including one deep inside a
            // SERVED project's own graph, not just this package's direct dependencies) against
            // WHATEVER `nodeModulesDir` the process's own governing config declares — never the
            // served project's, even when that project sets its own `nodeModulesDir: "auto"` and
            // has a real local `node_modules` tree. Without this, a real global install resolves
            // deep npm dependencies against Deno's flat global cache instead, where a legacy
            // "private stub subpath" package (a folder holding only a `package.json` whose `main`
            // escapes its own directory via `../`) fails to resolve at all — confirmed live:
            // `@radix-ui/react-dialog`'s own `react-remove-scroll-bar/constants` dependency, reached
            // through `zanix space build`'s SSR render of an unrelated served project, throws
            // `Cannot find module ... verify main entry` without it.
            nodeModulesDir: publishedConfig.nodeModulesDir,
            imports,
          },
          null,
          2,
        ) + '\n',
      )
      configArgs = ['--config', filteredConfigPath]
    } catch {
      warn(
        "Could not filter the published config — proceeding without it (native resolution may reject a freshly-published or npm-cached dependency until 'deno task cli:install' or a manual retry).",
      )
    }
  } else {
    warn(
      "Could not fetch the published config — proceeding without it (native resolution may reject a freshly-published or npm-cached dependency until 'deno task cli:install' or a manual retry).",
    )
  }
}

// `--minimum-dependency-age 0` is required: installing a version published within Deno's default
// 24h freshness window — routine right after a release — otherwise rejects outright, even for
// this package's own entry-point resolution. `-f` in `--local` mode force-overwrites any existing
// install instead of the interactive confirm flow above (skipped entirely in that mode).
{
  const { success, output } = await run('deno', [
    'install',
    '-A',
    '-g',
    '-n',
    BIN_NAME,
    '--minimum-dependency-age',
    '0',
    ...(isLocal ? ['-f'] : []),
    ...configArgs,
    APP,
  ])
  if (filteredConfigPath) await Deno.remove(filteredConfigPath).catch(() => {})
  if (!success) {
    console.log(output)
    fail(
      `Failed to install '${BIN_NAME}' (${
        isLocal ? 'local checkout' : `version ${VERSION}`
      }) via 'deno install'.`,
    )
  }
}

// Test and install dependencies on first run. Same capture-then-check approach: quiet on
// success, but a broken/misconfigured install now fails loudly instead of silently claiming
// success below.
{
  const { success, output } = await run(BIN_NAME, [])
  if (!success) {
    console.log(output)
    fail(`'${BIN_NAME}' was installed but failed to run (smoke test failed).`)
  }
}

// The shim's own generated lockfile only covers dependencies reachable from `mod.ts`'s static
// import graph — a command whose body lives in a dynamically-imported `action.ts` resolves fresh
// at runtime instead, hitting Deno's default freshness window regardless of this package's own
// `minimumDependencyAge`. Merges this package's own published lockfile (which does cover those,
// generated from a full `deno test` run) into the shim's, adding only what the install step
// didn't already resolve. Best-effort — never fails the whole install over a sync failure here.
//
// `--local` mode has no "published" lockfile to fetch and merge — this checkout's own `deno.lock`
// already covers its full local dependency graph (assuming it's current), so it's copied over the
// shim's wholesale instead, same as the standalone `cli:install` task line this replaced.
info('Syncing dependency lockfile...')
{
  const denoInstallRoot = Deno.env.get('DENO_INSTALL_ROOT') ??
    `${Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE')}/.deno`
  const shimLockPath = `${denoInstallRoot}/bin/.${BIN_NAME}/deno.lock`
  if (isLocal) {
    const localLockPath = fromFileUrl(new URL('../../deno.lock', import.meta.url))
    await Deno.copyFile(localLockPath, shimLockPath).catch(() =>
      warn(`Could not copy this checkout's own 'deno.lock' into the shim (${shimLockPath}).`)
    )
  } else {
    const shimLockExists = await Deno.stat(shimLockPath).then(() => true).catch(() => false)
    if (shimLockExists) {
      const lockResponse = await fetch(`https://jsr.io/@zanix/cli/${VERSION}/deno.lock`).catch(() =>
        null
      )
      if (lockResponse?.ok) {
        try {
          const shim = JSON.parse(await Deno.readTextFile(shimLockPath))
          const published = await lockResponse.json()
          for (const section of ['specifiers', 'jsr', 'npm']) {
            for (const [key, value] of Object.entries(published[section] ?? {})) {
              shim[section] ??= {}
              if (!(key in shim[section])) shim[section][key] = value
            }
          }
          await Deno.writeTextFile(shimLockPath, JSON.stringify(shim, null, 2) + '\n')
        } catch {
          warn(
            `Lockfile sync failed — '${BIN_NAME} space dev'/'build' may reject a freshly-published dependency until a retry.`,
          )
        }
      } else {
        warn(
          `Could not fetch the published lockfile — '${BIN_NAME} space dev'/'build' may reject a freshly-published dependency.`,
        )
      }
    }
  }
}

// Final message
console.log(`\n${SEPARATOR}`)
console.log(colors.blue('🎉 Installation completed!'))
console.log(colors.blue(`✨ You can use the '${BIN_NAME}' command from any terminal.`))
console.log(colors.blue(`📦 Version: ${isLocal ? 'local checkout' : VERSION}`))
console.log(SEPARATOR)
