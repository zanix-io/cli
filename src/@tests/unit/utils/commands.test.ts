import { assertEquals } from '@std/assert'
import { Command } from '@cliffy/command'
import { stub } from '@std/testing/mock'
import { baseArgumentActionCommand } from 'utils/commands.ts'
import { Commander } from 'cli'

Deno.test(
  'baseArgumentActionCommand declares required arguments before optional ones',
  async () => {
    const root = new Commander()
    let received: unknown[] = []

    baseArgumentActionCommand.call(root, {
      name: 'greet',
      description: 'test command',
      requiredArgs: ['name'],
      optionalArgs: ['greeting'],
      action(_options, ...args) {
        received = args
      },
    })

    // A required arg declared AFTER an optional one (the pre-fix, backwards order) makes cliffy
    // treat the first positional token as the optional arg and leaves the required one
    // unsatisfied — this only passes with `<name> [greeting]`, never `[greeting] <name>`.
    await root.parse(['greet', 'Ada', 'hello'])

    assertEquals(received, ['Ada', 'hello'])
  },
)

Deno.test(
  'baseArgumentActionCommand still works with only optional arguments (the common case today)',
  async () => {
    const root = new Commander()
    let received: unknown[] = []

    baseArgumentActionCommand.call(root, {
      name: 'scaffold',
      description: 'test command',
      optionalArgs: ['appName'],
      action(_options, ...args) {
        received = args
      },
    })

    await root.parse(['scaffold', 'my-app'])

    assertEquals(received, ['my-app'])
  },
)

// Regression coverage for the `this` mis-binding found while investigating the `zanix new`
// silent-failure bug: `baseArgumentActionCommand` is always called on a pseudo-parent (e.g.
// `commands/new/base.ts`'s own `cwd`), one level above the real leaf command it registers (e.g.
// `space`) — mirrored here with the same two-level shape (`root -> cwd -> leaf`), not a flat
// `root -> leaf` tree, since that's exactly the shape that exposed the bug.
Deno.test(
  "baseArgumentActionCommand's action receives `this` as the real leaf command it was mounted " +
    'as, not the pseudo-parent it was registered on',
  async () => {
    const root = new Command()
    const cwd = new Commander()
    let capturedName: string | undefined

    baseArgumentActionCommand.call(cwd, {
      name: 'space',
      description: 'test leaf',
      optionalArgs: ['appName'],
      action(this: Command, _options, ..._args) {
        capturedName = this.getName()
      },
    })
    root.command('new', cwd)

    await root.parse(['new', 'space', 'my-app'])

    assertEquals(capturedName, 'space')
  },
)

// Regression coverage for the companion bug: cliffy's own `getErrorHandler()` only checks one
// level up the parent chain (`this.errorHandler ?? this._parent?.errorHandler`, not the full
// chain — @cliffy/command@1.0.0-rc.8's `command.ts:1165-1167`), so before `Commander.mountGroup`
// existed, an error escaping a leaf command's action two levels below `cli` (e.g. `cli -> new ->
// space`, `cli.ts`'s only place with a registered `.error()` handler) never reached it — it
// free-fell as a raw, unformatted rejection instead of the clean `logger.error` + exit(1) UX.
Deno.test(
  'an error escaping a leaf action two levels below the root still reaches the root error handler',
  async () => {
    // `setErrorHandler()` — not a bare `.error()` — because `mountGroup` only propagates the
    // handler it tracked from that call (`Commander`'s own `errorHandlerFn` field); it has no way
    // to observe a handler set some other way, same as in production (`cli.ts`).
    const root = new Commander().setErrorHandler()
    const cwd = new Commander()

    baseArgumentActionCommand.call(cwd, {
      name: 'space',
      description: 'test leaf',
      optionalArgs: ['appName'],
      action() {
        throw new Error('boom from leaf action')
      },
    })
    root.mountGroup('new', cwd).description('test group')

    const exitStub = stub(Deno, 'exit', () => undefined as never)
    const errorStub = stub(console, 'error', () => {})
    const logStub = stub(console, 'log', () => {})
    try {
      // `Deno.exit` is stubbed to a no-op above, so execution continues past it: cliffy's own
      // `throw()` still re-throws afterward (a plain `Error`, and `root.throwErrors()` is set) —
      // exactly like production, where the real `Deno.exit(1)` would end the process first.
      await root.parse(['new', 'space', 'my-app'])
    } catch {
      // expected — see comment above
    } finally {
      exitStub.restore()
      errorStub.restore()
      logStub.restore()
    }

    // The real handler (`cli.ts`'s `setErrorHandler`) calls `Deno.exit(1)` itself — reaching it
    // means the leaf's error found the root's handler through the `new` pseudo-parent, instead of
    // free-falling past both as a raw, unformatted rejection.
    assertEquals(exitStub.calls.length, 1)
    assertEquals(exitStub.calls[0].args, [1])
  },
)
