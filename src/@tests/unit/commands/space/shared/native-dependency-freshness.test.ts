import { assertEquals } from '@std/assert'
import {
  type DenoLockFile,
  isLockReadable,
  isNewerRelease,
  mergeLockUpdates,
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

const emptyUpdates = { specifiers: {}, jsr: {}, npm: {} }

Deno.test('mergeLockUpdates: specifiers are overwritten, the rest of the lock is kept', () => {
  const lock: DenoLockFile = {
    version: '5',
    specifiers: { 'jsr:a@1': '1.0.0', 'jsr:b@1': '1.0.0' },
  }
  const merged = mergeLockUpdates(lock, [{ ...emptyUpdates, specifiers: { 'jsr:a@1': '1.1.0' } }])

  assertEquals(merged.specifiers, { 'jsr:a@1': '1.1.0', 'jsr:b@1': '1.0.0' })
  assertEquals(merged.version, '5')
  assertEquals(lock.specifiers?.['jsr:a@1'], '1.0.0', 'the original lock is not mutated')
})

Deno.test('mergeLockUpdates: a jsr block that the lock already has is never replaced', () => {
  const lock: DenoLockFile = { jsr: { 'a@1.0.0': { dependencies: ['x'] } } }
  const merged = mergeLockUpdates(lock, [{
    ...emptyUpdates,
    jsr: { 'a@1.0.0': { dependencies: ['x', 'y'] }, 'a@1.1.0': { dependencies: [] } },
  }])

  assertEquals(merged.jsr?.['a@1.0.0'], { dependencies: ['x'] })
  assertEquals(merged.jsr?.['a@1.1.0'], { dependencies: [] })
})

Deno.test('mergeLockUpdates: a peer-suffixed variant of an npm package version the lock has is skipped', () => {
  const lock: DenoLockFile = { npm: { 'preact@10.29.8': { integrity: 'p' } } }
  const merged = mergeLockUpdates(lock, [{
    ...emptyUpdates,
    npm: {
      'preact@10.29.8_preact-render-to-string@6.7.0': { integrity: 'p' },
      'preact-render-to-string@6.7.0_preact@10.29.8': { integrity: 'r' },
    },
  }])

  assertEquals(Object.keys(merged.npm ?? {}).sort(), [
    'preact-render-to-string@6.7.0_preact@10.29.8',
    'preact@10.29.8',
  ])
})

Deno.test('mergeLockUpdates: a new npm package, or a new version of one, is added', () => {
  const lock: DenoLockFile = { npm: { 'preact@10.29.8': {}, '@scope/pkg@1.0.0': {} } }
  const merged = mergeLockUpdates(lock, [{
    ...emptyUpdates,
    npm: { 'preact@10.30.0': {}, '@scope/pkg@1.0.0_peer@2.0.0': {}, 'some_pkg@1.0.0': {} },
  }])

  assertEquals(Object.keys(merged.npm ?? {}).sort(), [
    '@scope/pkg@1.0.0',
    'preact@10.29.8',
    'preact@10.30.0',
    'some_pkg@1.0.0',
  ])
})

Deno.test('mergeLockUpdates: an undefined update is ignored and the first update to add a package wins', () => {
  const merged = mergeLockUpdates({}, [
    undefined,
    { ...emptyUpdates, npm: { 'a@1.0.0': { from: 'first' } } },
    { ...emptyUpdates, npm: { 'a@1.0.0_b@1.0.0': { from: 'second' } } },
  ])

  assertEquals(merged.npm, { 'a@1.0.0': { from: 'first' } })
})

Deno.test('mergeLockUpdates: resolved specifiers a merged jsr block depends on are added, never overwriting a pin', () => {
  const lock: DenoLockFile = {
    specifiers: { 'jsr:@zanix/app@^1.0.2': '1.0.2', 'jsr:@zanix/server@^4.3.0': '4.3.0' },
    jsr: { '@zanix/app@1.0.2': { dependencies: ['jsr:@zanix/server@^4.3.0'] } },
  }
  const merged = mergeLockUpdates(lock, [{
    specifiers: { 'jsr:@zanix/app@^1.0.2': '1.0.3' },
    resolvedSpecifiers: {
      'jsr:@zanix/app@^1.0.2': '1.0.3',
      'jsr:@zanix/server@^4.3.0': '4.3.4',
      'jsr:@zanix/server@^4.3.4': '4.3.4',
    },
    jsr: { '@zanix/app@1.0.3': { dependencies: ['jsr:@zanix/server@^4.3.4'] } },
    npm: {},
  }])

  assertEquals(merged.specifiers, {
    'jsr:@zanix/app@^1.0.2': '1.0.3',
    'jsr:@zanix/server@^4.3.0': '4.3.0',
    'jsr:@zanix/server@^4.3.4': '4.3.4',
  })
})

/** The shape of a real merged lock Deno rejected: a jsr block depending on a specifier key the
 * lock's `specifiers` lacks. */
const lockWithMissingSpecifier: DenoLockFile = {
  version: '5',
  specifiers: { 'jsr:@zanix/app@^1.0.2': '1.0.3' },
  jsr: {
    '@zanix/app@1.0.3': {
      integrity: '27963bde86b8759605bf054ddc96770ee7757462bf27337526cfe28756cb07e0',
      dependencies: ['jsr:@zanix/server@^4.3.4'],
    },
  },
}

Deno.test('isLockReadable: a lock whose jsr block references a missing specifier is unreadable', async () => {
  assertEquals(await isLockReadable(lockWithMissingSpecifier), false)
})

Deno.test('isLockReadable: the same lock with the specifier added is readable', async () => {
  const lock: DenoLockFile = {
    ...lockWithMissingSpecifier,
    specifiers: { ...lockWithMissingSpecifier.specifiers, 'jsr:@zanix/server@^4.3.4': '4.3.4' },
    jsr: {
      ...lockWithMissingSpecifier.jsr,
      '@zanix/server@4.3.4': { integrity: '00' },
    },
  }
  assertEquals(await isLockReadable(lock), true)
})
