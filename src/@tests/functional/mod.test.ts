import { assertNotEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl } from '@std/path'

const modPath = fromFileUrl(new URL('../../../mod.ts', import.meta.url))

// Regression for `mod.ts`'s top-level error boundary: any error that escapes CLI init/execution
// (not just the ones cliffy's own `.error()` handler in `cli.ts` catches) must still be reported
// via `console.error` and exit non-zero — never silently exit 0.
//
// Running without any permission flags is a real, deterministic way to trigger such an escaped
// error here: it fails on a permission check deep in the CLI's own module-load path, before any
// subcommand action runs and before cliffy's own error handler is even reachable — the exact
// class of failure this boundary exists to catch, independent of any specific command's logic.
Deno.test(
  "mod.ts: an error that escapes CLI init is reported via console.error and exits non-zero, never silently 'succeeds'",
  async () => {
    const { code, stdout, stderr } = await new Deno.Command('deno', {
      args: ['run', modPath, '--help'],
      stdin: 'null',
    }).output()

    const stdoutText = new TextDecoder().decode(stdout)
    const stderrText = new TextDecoder().decode(stderr)

    assertNotEquals(
      code,
      0,
      `expected a non-zero exit code, got 0. stdout:\n${stdoutText}\nstderr:\n${stderrText}`,
    )
    assertStringIncludes(
      stderrText,
      'NotCapable',
      `expected the escaped error to be printed to stderr, got:\n${stderrText}`,
    )
  },
)
