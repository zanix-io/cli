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
 */

import { parse as parseJsonc } from '@std/jsonc'

// Derived from this package's own `deno.jsonc`, not a hardcoded literal — the source of truth
// for what "latest" means stays in one place. `fetch` (not `Deno.readTextFile`) works whether
// `import.meta.url` is a real `file://` checkout or `https://jsr.io/...`. Falls back to a fixed
// literal only if this file is ever invoked outside its own published package layout.
const LATEST = await fetch(new URL('../../deno.jsonc', import.meta.url))
  .then((response) => response.text())
  .then((text) => (parseJsonc(text) as { version: string }).version)
  .catch(() => '2.0.8')
const VERSION = Deno.args[0] ?? LATEST
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

// Check if Zanix is already installed
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

const APP = `jsr:@zanix/cli@${VERSION}`

// `deno install -g`'s own generated shim runs under a synthetic, install-time config — this
// package's own published `deno.jsonc` (and the `imports` map every native `import()` this
// package performs against a bare specifier needs) is never consulted unless `--config` is passed
// to `deno install` itself. Fetched fresh for this install and filtered down to genuine
// scheme-based entries only (`jsr:`/`npm:`/`http(s):`) — this package's own internal local
// aliases (`typings/`, `shared/`, ...) would resolve against wherever this temp file sits, not
// this package's real source tree, so they're dropped.
let configArgs: string[] = []
let filteredConfigPath: string | undefined
{
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
            // has a real local `node_modules` tree. Omitting it here left every real global install
            // resolving deep npm dependencies against Deno's flat global cache instead, where a
            // legacy "private stub subpath" package (a folder holding only a `package.json` whose
            // `main` escapes its own directory via `../`) fails to resolve at all — confirmed live:
            // `@radix-ui/react-dialog`'s own `react-remove-scroll-bar/constants` dependency, reached
            // through `zanix space build`'s SSR render of an unrelated served project, threw `Cannot
            // find module ... verify main entry` until this value was restored.
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
// this package's own entry-point resolution.
{
  const { success, output } = await run('deno', [
    'install',
    '-A',
    '-g',
    '-n',
    BIN_NAME,
    '--minimum-dependency-age',
    '0',
    ...configArgs,
    APP,
  ])
  if (filteredConfigPath) await Deno.remove(filteredConfigPath).catch(() => {})
  if (!success) {
    console.log(output)
    fail(`Failed to install '${BIN_NAME}' (version ${VERSION}) via 'deno install'.`)
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
info('Syncing dependency lockfile...')
{
  const denoInstallRoot = Deno.env.get('DENO_INSTALL_ROOT') ??
    `${Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE')}/.deno`
  const shimLockPath = `${denoInstallRoot}/bin/.${BIN_NAME}/deno.lock`
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

// Final message
console.log(`\n${SEPARATOR}`)
console.log(colors.blue('🎉 Installation completed!'))
console.log(colors.blue(`✨ You can use the '${BIN_NAME}' command from any terminal.`))
console.log(colors.blue(`📦 Version: ${VERSION}`))
console.log(SEPARATOR)
