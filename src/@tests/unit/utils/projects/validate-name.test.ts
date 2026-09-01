import { assertThrows } from '@std/assert'
import { assertSafeProjectName } from 'utils/projects/validate-name.ts'

/**
 * Regression coverage for a confirmed risk: `zanix new <type> <name>` used to pass `name` straight
 * into a directory path with no validation at all — a name containing a `..` traversal segment
 * (plausible from an automated/scripted caller of this CLI, not only a human typing it
 * interactively) could write the new project's files outside the intended directory, up to the
 * filesystem root. A plain leaf name, a nested relative path, and an absolute path are all
 * legitimate today (every `new` action's own test suite passes a full temp-dir path as the name),
 * so only `..` itself is rejected — never `/`/`\` or an absolute path on their own.
 */

Deno.test('assertSafeProjectName: an ordinary leaf name is accepted', () => {
  assertSafeProjectName('my-server')
})

Deno.test('assertSafeProjectName: a nested relative path is accepted', () => {
  assertSafeProjectName('projects/my-server')
})

Deno.test('assertSafeProjectName: an absolute path is accepted', () => {
  assertSafeProjectName('/tmp/zanix-fixture/my-server')
})

Deno.test('assertSafeProjectName: rejects a ".." traversal segment', () => {
  assertThrows(() => assertSafeProjectName('../../etc/cron.d/evil'), Error)
  assertThrows(() => assertSafeProjectName('a/../../b'), Error)
  assertThrows(() => assertSafeProjectName('..'), Error)
})

Deno.test('assertSafeProjectName: rejects a ".." segment on a Windows-style path', () => {
  assertThrows(() => assertSafeProjectName('..\\..\\evil'), Error)
})

Deno.test('assertSafeProjectName: rejects an empty name', () => {
  assertThrows(() => assertSafeProjectName(''), Error)
})

Deno.test("assertSafeProjectName: a bare '.' segment is not traversal, accepted", () => {
  assertSafeProjectName('.')
  assertSafeProjectName('./my-server')
})

Deno.test('assertSafeProjectName: with { allowEmpty: true }, an empty name is accepted', () => {
  assertSafeProjectName('', { allowEmpty: true })
})

Deno.test(
  'assertSafeProjectName: with { allowEmpty: true }, a ".." traversal segment is still rejected',
  () => {
    assertThrows(
      () => assertSafeProjectName('../../etc/cron.d/evil', { allowEmpty: true }),
      Error,
    )
  },
)
