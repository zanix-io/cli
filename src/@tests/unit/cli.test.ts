import type { Commander } from 'cli'
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import cli from 'cli'

type ErrorHandlerHolder = { settings: { errorHandler: (e: Error, cwd: Commander) => void } }

console.error = () => {}
console.info = () => {}

Deno.test('cli error handler should strip the stack, log the message and exit(1)', () => {
  const exitStub = stub(Deno, 'exit', () => undefined as never)
  const error = new Error('boom')

  try {
    ;(cli as unknown as ErrorHandlerHolder).settings.errorHandler(error, cli)
  } finally {
    exitStub.restore()
  }

  assertEquals(error.stack, undefined)
  assertEquals(exitStub.calls.length, 1)
  assertEquals(exitStub.calls[0].args, [1])
})
