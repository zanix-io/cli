import { assertEquals } from '@std/assert'
import {
  type DenoLockFile,
  isNewerRelease,
  NATIVE_FRESHNESS_REEXEC_ENV,
  prepareNativeFreshnessReexec,
  refreshTrackedRanges,
  trackedRangeLiterals,
} from 'commands/space/shared/native-dependency-freshness.ts'

Deno.test('isNewerRelease: a real, strictly higher patch/minor/major is newer', () => {
  assertEquals(isNewerRelease('4.2.5', '4.2.3'), true)
  assertEquals(isNewerRelease('4.3.0', '4.2.9'), true)
  assertEquals(isNewerRelease('5.0.0', '4.9.9'), true)
})

Deno.test('isNewerRelease: an equal or older release is never newer', () => {
  assertEquals(isNewerRelease('4.2.3', '4.2.3'), false)
  assertEquals(isNewerRelease('4.2.2', '4.2.3'), false)
  assertEquals(isNewerRelease('3.9.9', '4.0.0'), false)
})

Deno.test('isNewerRelease: patch only compared once major/minor already tie', () => {
  // Same major/minor, patch decides — the one shape a naive major-only or minor-only compare
  // would get wrong.
  assertEquals(isNewerRelease('4.2.10', '4.2.9'), true)
  assertEquals(isNewerRelease('4.2.9', '4.2.10'), false)
})

Deno.test('isNewerRelease: a malformed version on either side degrades to false, never a crash', () => {
  assertEquals(isNewerRelease('not-a-version', '4.2.3'), false)
  assertEquals(isNewerRelease('4.2.5', 'not-a-version'), false)
  assertEquals(isNewerRelease('4.2.5-rc.1', '4.2.3'), false)
})

Deno.test('trackedRangeLiterals: matches every specifier key for the exact package base', () => {
  const lock: DenoLockFile = {
    specifiers: {
      'jsr:@zanix/server@4': '4.2.3',
      'jsr:@zanix/server@^4.1.0': '4.2.3',
      'jsr:@zanix/server@^4.2.1': '4.2.3',
      'jsr:@zanix/app@^1.0.2': '1.0.2',
    },
  }
  assertEquals(
    trackedRangeLiterals(lock, '@zanix/server').sort(),
    ['jsr:@zanix/server@4', 'jsr:@zanix/server@^4.1.0', 'jsr:@zanix/server@^4.2.1'],
  )
})

Deno.test(
  'trackedRangeLiterals: never false-positives on a package whose name merely starts with the same text',
  () => {
    // `@zanix/server-extra` is a real, different package name — a naive prefix check without the
    // trailing `@` would wrongly fold it into `@zanix/server`'s own tracked ranges.
    const lock: DenoLockFile = {
      specifiers: {
        'jsr:@zanix/server@^4.2.1': '4.2.3',
        'jsr:@zanix/server-extra@^1.0.0': '1.0.0',
      },
    }
    assertEquals(trackedRangeLiterals(lock, '@zanix/server'), ['jsr:@zanix/server@^4.2.1'])
  },
)

Deno.test('trackedRangeLiterals: an empty/missing specifiers map is a real, empty result — never a crash', () => {
  assertEquals(trackedRangeLiterals({}, '@zanix/server'), [])
  assertEquals(trackedRangeLiterals({ specifiers: {} }, '@zanix/server'), [])
})

Deno.test(
  'refreshTrackedRanges: a range that genuinely fails to resolve (no network, or a registry that simply has no such version) reports attempted > 0 with succeeded === 0 — the one signal prepareNativeFreshnessReexec relies on to skip caching a failure as if it were a real "nothing newer" answer',
  async () => {
    const lock: DenoLockFile = {
      specifiers: {
        // A real package name, but a version range that can never resolve — the same real,
        // observable failure a genuine network outage would also produce from `resolveRangeFresh`'s
        // own point of view (a non-zero `deno info` exit code either way).
        'jsr:@zanix/server@^999.0.0': '4.2.3',
      },
    }
    const result = await refreshTrackedRanges(lock, '@zanix/server')
    assertEquals(result.attempted, 1)
    assertEquals(result.succeeded, 0)
    assertEquals(result.specifiers, {})
  },
)

Deno.test(
  'refreshTrackedRanges: a package with no tracked ranges at all reports attempted === 0 — a real, meaningful "nothing to check" answer, never confused with a failed check',
  async () => {
    const result = await refreshTrackedRanges({ specifiers: {} }, '@zanix/server')
    assertEquals(result.attempted, 0)
    assertEquals(result.succeeded, 0)
  },
)

Deno.test(
  'prepareNativeFreshnessReexec: the guard env var short-circuits before any lock is even located — the exact mechanism every real `zanix space dev`/`build` integration test relies on (disableNativeFreshnessCheckForTests) to avoid a real Deno.exit() under `deno test`',
  async () => {
    const original = Deno.env.get(NATIVE_FRESHNESS_REEXEC_ENV)
    Deno.env.set(NATIVE_FRESHNESS_REEXEC_ENV, '1')
    try {
      const result = await prepareNativeFreshnessReexec()
      assertEquals(result, undefined)
    } finally {
      if (original === undefined) Deno.env.delete(NATIVE_FRESHNESS_REEXEC_ENV)
      else Deno.env.set(NATIVE_FRESHNESS_REEXEC_ENV, original)
    }
  },
)
