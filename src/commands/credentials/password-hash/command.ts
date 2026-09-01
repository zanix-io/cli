import type { Commander } from 'cli'
import type { EncryptionLevel } from '@zanix/types'

import { generateHash } from '@zanix/helpers'
import { promptSecret } from '@std/cli'
import logger from '@zanix/utils/logger'

/** `generateHash()`'s own real closed set (`@zanix/utils`'s `typings/encryption.ts`) — mirrored
 * here only for `--level`'s own choice validation; `EncryptionLevel` itself stays the single
 * source of truth for the values. */
const VALID_LEVELS: EncryptionLevel[] = ['low', 'medium', 'medium-high', 'high']

/**
 * Prompts twice for a hidden, un-echoed password and confirms both entries match before
 * returning it — the same "type it twice" guard any real password-setting flow needs, since a
 * typo here is invisible (masked input) and only surfaces later, as a login that mysteriously
 * never validates.
 *
 * `promptFn` returns `null` when stdin isn't a real terminal (piped input, a non-interactive CI
 * shell, ...) — routed through `cwd.throw` pointing the caller at the positional argument
 * instead, rather than a confusing `null`-shaped failure deeper in `generateHash`.
 *
 * @param cwd The command instance (`this` inside {@linkcode generateCredentialsPasswordHashAction}),
 * used to route a failure through Cliffy's own error pipeline via `cwd.throw`.
 * @param promptFn The real prompt function, `promptSecret` (`@std/cli`) by default — overridable
 * so a test can exercise the empty-password/mismatched-confirmation branches directly, without
 * needing a real interactive terminal on stdin to reach past the first prompt at all.
 * @returns The confirmed password, exactly as typed.
 */
export function promptForPassword(
  cwd: Commander,
  promptFn: (message: string) => string | null = promptSecret,
): string {
  const first = promptFn('Password to hash:')
  if (first === null) {
    cwd.throw(
      new Error(
        "'zanix credentials password-hash' needs a password — either pass it as an argument " +
          "('zanix credentials password-hash <password>') or run this in a real interactive " +
          'terminal, where it prompts for one (hidden input, never echoed or logged).',
      ),
    )
    return ''
  }

  if (!first) {
    cwd.throw(new Error("'zanix credentials password-hash': an empty password is not allowed."))
    return ''
  }

  const confirm = promptFn('Confirm password:')
  if (confirm !== first) {
    cwd.throw(
      new Error(
        "'zanix credentials password-hash': the two entries didn't match — run the command " +
          'again and type the same password both times.',
      ),
    )
    return ''
  }

  return first
}

/**
 * `zanix credentials password-hash [password]`'s real orchestration: hashes `password` via
 * `generateHash()` (`@zanix/helpers`) and prints the resulting `<salt-hex>$<hash-base64>` value,
 * single-quoted, ready to paste into a real `.env` file.
 *
 * **A real Deno `--env-file` footgun, not a hypothetical one.** `generateHash()`'s own output
 * format carries a LITERAL `$` character — Deno's own `--env-file` parsing applies dotenv-style
 * `$VAR`/`${VAR}` expansion to an UNQUOTED value, silently truncating everything from that `$`
 * onward and leaving a shorter, broken hash with no error at all; the resulting login then fails
 * for a reason that looks nothing like "the env var is malformed". Printing the value pre-quoted,
 * rather than just describing the rule in prose, is what actually prevents it — a value already
 * wrapped in single quotes is copy-pastable as-is.
 *
 * Never echoes, logs, or otherwise surfaces the plaintext password itself anywhere in this
 * command's own output — only the resulting hash.
 *
 * @param options.level The same {@link EncryptionLevel} `generateHash()`/`validateHash()` both
 * take — MUST match whatever level the consuming project's own `validateHash()` call uses (the
 * default, `'medium'`, is what every current real consumer — `console`'s own
 * `login.interactor.ts` — validates against); a mismatched level produces a hash that a correctly
 * configured `validateHash()` call never accepts.
 * @param options.varName When given, prints a ready `NAME='<hash>'` line instead of the bare
 * quoted value — the same "ready to paste, not just printed" convention `zanix credentials mesh`
 * already established for its own `.env` blocks.
 * @param password The plaintext password to hash. Omit it to be prompted interactively instead
 * (hidden input) — the safer default: a password passed as a real CLI argument is visible in
 * shell history and any process listing for as long as either persists.
 * @throws {Error} Routed through `this.throw` (Cliffy's `throwErrors()`-configured error
 * pipeline, same convention every other command in this package uses) if `options.level` isn't
 * one of {@linkcode VALID_LEVELS}, if no password is given and stdin isn't a real interactive
 * terminal, if an interactively-typed password is empty, or if its confirmation doesn't match.
 */
export async function generateCredentialsPasswordHashAction(
  this: Commander,
  options: { level: EncryptionLevel; varName?: string },
  password?: string,
): Promise<void> {
  if (!VALID_LEVELS.includes(options.level)) {
    this.throw(
      new Error(
        `Invalid --level "${options.level}" — it must be one of: ${VALID_LEVELS.join(', ')}.`,
      ),
    )
    return
  }

  const plain = password ?? promptForPassword(this)

  const hash = await generateHash(plain, options.level)
  const line = options.varName ? `${options.varName}='${hash}'` : `'${hash}'`

  // Deliberately bypasses `logger` here — every `logger` method prepends a colored, timestamped
  // header onto the SAME console call as its own first argument, which would corrupt this line
  // for anyone copy-pasting it straight into a real `.env` file (same convention `zanix
  // credentials mesh`'s own output already follows, see that command's own doc).
  // deno-lint-ignore deno-zanix-plugin/no-znx-console
  console.log(line)

  logger.info(
    `Generated a password hash (level: '${options.level}') — paste the single-quoted value ` +
      "above into your .env file exactly as shown, never unquoted (see this command's own " +
      '--help for the real Deno --env-file $-expansion footgun this avoids). Nothing was ' +
      'written to disk.',
  )
}

export default generateCredentialsPasswordHashAction

/**
 * Registers `zanix credentials password-hash` under the `credentials` group's own `cwd` — see
 * `commands/credentials/main.ts` for the parent group.
 */
export function registerCredentialsPasswordHashCommand(cwd: Commander): void {
  cwd.command('password-hash')
    .description(
      "Hashes a password via @zanix/helpers' generateHash(), printing a single-quoted, ready-" +
        "to-paste '.env' value — closes a real Deno --env-file footgun (an unquoted value's own " +
        'literal "$" triggers silent dotenv-style expansion, truncating the hash with no error). ' +
        'Prompts interactively (hidden input) when no password argument is given.',
    )
    .arguments('[password:string]')
    .option(
      '-l, --level <level:string>',
      `The encryption level generateHash()/validateHash() both take — MUST match whatever level ` +
        `the consuming project's own validateHash() call uses. One of: ${VALID_LEVELS.join(', ')}.`,
      { default: 'medium' as EncryptionLevel },
    )
    .option(
      '-n, --var-name <name:string>',
      "Prints a ready 'NAME=<hash>' line instead of the bare quoted value.",
    )
    .action((options, password?: string) =>
      generateCredentialsPasswordHashAction.call(
        cwd,
        options as { level: EncryptionLevel; varName?: string },
        password,
      )
    )
}
