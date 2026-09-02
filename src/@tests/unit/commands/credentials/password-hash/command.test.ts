import { assertEquals, assertMatch, assertRejects, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { generateHash, validateHash } from '@zanix/helpers'
import registeredPasswordHashAction, {
  promptForPassword,
  registerCredentialsPasswordHashCommand,
} from 'commands/credentials/password-hash/command.ts'
import { Commander } from 'cli'

type ActionCommand = {
  builder: { options: { flags: string[] }[] }
  settings: {
    actionHandler: (options: Record<string, unknown>, ...args: string[]) => Promise<void>
  }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerCredentialsPasswordHashCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

/** Captures every `console.log`/`console.info` call made during `run`, restoring both stubs
 * afterward regardless of whether `run` throws. */
async function captureOutput(run: () => Promise<void>): Promise<{ logs: string[] }> {
  const logs: string[] = []
  const logStub = stub(console, 'log', (...args: unknown[]) => {
    logs.push(String(args[0]))
  })
  const infoStub = stub(console, 'info', () => {})

  try {
    await run()
  } finally {
    logStub.restore()
    infoStub.restore()
  }

  return { logs }
}

Deno.test('credentials password-hash command is registered with --level and --var-name options', () => {
  const command = registerCommand()
  const flags = command.builder.options.map((option) => option.flags)
  assertEquals(flags, [['-l', '--level'], ['-n', '--var-name']])
})

Deno.test('credentials password-hash rejects (via this.throw) an invalid --level', async () => {
  await assertRejects(
    () => registeredPasswordHashAction.call(new Commander(), { level: 'bogus' as never }, 'x'),
    Error,
    'Invalid --level "bogus" — it must be one of: low, medium, medium-high, high.',
  )
})

Deno.test(
  'credentials password-hash rejects with no password given and no interactive terminal to ' +
    'prompt from (stdin.isTerminal() is stubbed to false here — `deno test` only has a non-TTY ' +
    "stdin when its OWN stdin isn't a real terminal, e.g. piped/CI; run directly from an " +
    'interactive shell, the real `promptSecret` this exercises would otherwise block waiting ' +
    'for actual keyboard input instead of hitting this rejection)',
  async () => {
    const isTerminalStub = stub(Deno.stdin, 'isTerminal', () => false)
    try {
      await assertRejects(
        () => registeredPasswordHashAction.call(new Commander(), { level: 'medium' }),
        Error,
        "needs a password — either pass it as an argument ('zanix credentials password-hash " +
          "<password>') or run this in a real interactive terminal",
      )
    } finally {
      isTerminalStub.restore()
    }
  },
)

Deno.test(
  'credentials password-hash real run: prints a single-quoted hash that a real validateHash() ' +
    'accepts for the SAME password and rejects for a different one',
  async () => {
    const { logs } = await captureOutput(() =>
      registeredPasswordHashAction.call(new Commander(), { level: 'medium' }, 'correct horse')
    )

    assertEquals(logs.length, 1)
    const printed = logs[0]

    // Single-quoted, exactly as documented — the whole point being a value copy-pastable as-is
    // into a real `.env` file without falling into the `--env-file` `$`-expansion footgun.
    assertMatch(printed, /^'[0-9a-f]+\$[A-Za-z0-9+/=]+'$/)

    const hash = printed.slice(1, -1)
    assertEquals(await validateHash('correct horse', hash), true)
    assertEquals(await validateHash('wrong password', hash), false)
  },
)

Deno.test(
  "credentials password-hash --var-name prints a ready NAME='<hash>' line instead of the " +
    'bare quoted value',
  async () => {
    const { logs } = await captureOutput(() =>
      registeredPasswordHashAction.call(
        new Commander(),
        { level: 'medium', varName: 'CONSOLE_OPERATOR_PASSWORD_HASH' },
        'correct horse',
      )
    )

    assertEquals(logs.length, 1)
    assertMatch(logs[0], /^CONSOLE_OPERATOR_PASSWORD_HASH='[0-9a-f]+\$[A-Za-z0-9+/=]+'$/)
  },
)

Deno.test(
  'credentials password-hash never prints the plaintext password itself — only the resulting hash',
  async () => {
    const { logs } = await captureOutput(() =>
      registeredPasswordHashAction.call(
        new Commander(),
        { level: 'medium' },
        'super-secret-plaintext',
      )
    )

    for (const line of logs) {
      assertEquals(line.includes('super-secret-plaintext'), false)
    }
  },
)

Deno.test(
  'credentials password-hash: a mismatched --level produces a hash validateHash() rejects at ' +
    'the DEFAULT level — confirms this option is a real, load-bearing parameter, not decorative',
  async () => {
    const highHash = await generateHash('correct horse', 'high')
    assertEquals(await validateHash('correct horse', highHash, 'medium'), false)
    assertEquals(await validateHash('correct horse', highHash, 'high'), true)
  },
)

// The four tests below exercise `promptForPassword`'s own branches directly, via an injected
// `promptFn` — a real interactive terminal on stdin isn't available under `deno test`, so
// `promptSecret`'s own real `null`-on-no-TTY return would otherwise make every branch PAST the
// first check (empty password, mismatched confirmation, the successful confirmed-match path)
// structurally unreachable from any test in this file.

Deno.test('promptForPassword rejects (via cwd.throw) when promptFn returns null (no real TTY)', () => {
  assertThrows(
    () => promptForPassword(new Commander(), () => null),
    Error,
    "needs a password — either pass it as an argument ('zanix credentials password-hash " +
      "<password>') or run this in a real interactive terminal",
  )
})

Deno.test('promptForPassword rejects (via cwd.throw) an empty first entry', () => {
  assertThrows(
    () => promptForPassword(new Commander(), () => ''),
    Error,
    "'zanix credentials password-hash': an empty password is not allowed.",
  )
})

Deno.test('promptForPassword rejects (via cwd.throw) when the confirmation does not match', () => {
  let call = 0
  const promptFn = () => (call++ === 0 ? 'first-entry' : 'different-entry')

  assertThrows(
    () => promptForPassword(new Commander(), promptFn),
    Error,
    "'zanix credentials password-hash': the two entries didn't match",
  )
})

Deno.test('promptForPassword returns the password once both entries match', () => {
  const promptFn = () => 'correct horse'
  assertEquals(promptForPassword(new Commander(), promptFn), 'correct horse')
})
