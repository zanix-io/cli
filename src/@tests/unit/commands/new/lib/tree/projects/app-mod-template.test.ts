import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert'
import { getAppModTemplate } from 'commands/new/lib/tree/projects/app.ts'
import { PROJECT_TYPE_DEPENDENCIES, ZANIX_DEPENDENCY_VERSIONS } from 'utils/config/dependencies.ts'

// B3 (zero-silent-failures audit): `zanix new app`'s generated `mod.ts` used to violate its OWN
// scaffolded lint rules — `console.log` trips `no-znx-console` (auto-fixable via `deno lint --fix`
// since `@zanix/utils@3.0.0`, well below `ZANIX_DEPENDENCY_VERSIONS['@zanix/utils/logger']`'s own
// `^3.0.0` floor), and a bare `export default defineZanixApp({...})` trips JSR's
// `unsupported-default-export-expr` slow-types check at `deno publish` time. These cases pin both
// fixes structurally, not just "content changed" — a real `console.*` call in generated output
// would still report a violation even with the auto-fix available, so the generator itself must
// never emit one.

Deno.test(
  'getAppModTemplate: never emits a console.* call — a generated project that violated ' +
    'no-znx-console would still report the violation and block the installed pre-commit hook',
  () => {
    const content = getAppModTemplate('my-app')
    assertFalse(/console\s*\./.test(content), content)
  },
)

Deno.test(
  'getAppModTemplate: logs through the real Zanix logger instead — a real import, and a real call',
  () => {
    const content = getAppModTemplate('my-app')
    assert(content.includes("import logger from '@zanix/utils/logger'"), content)
    assertMatch(content, /logger\.info\(`?'?my-app started'?`?\)/)
  },
)

Deno.test(
  'getAppModTemplate: default export is explicitly typed via `as ZanixAppDefinition` — the shape ' +
    "confirmed (empirically, via `deno publish --dry-run`) to satisfy JSR's fast-check analyzer",
  () => {
    const content = getAppModTemplate('my-app')
    assert(
      content.includes("import { defineZanixApp, type ZanixAppDefinition } from '@zanix/app'"),
      content,
    )
    assert(content.trim().endsWith('}) as ZanixAppDefinition'), content)
  },
)

Deno.test(
  "getAppModTemplate: the app's name is still kebab-cased into both the manifest and the log line",
  () => {
    const content = getAppModTemplate('My Cool App')
    assert(content.includes("name: 'my-cool-app',"), content)
    assert(content.includes("logger.info('my-cool-app started')"), content)
  },
)

Deno.test(
  "app's dependency list declares both '@zanix/app' and '@zanix/utils/logger' — the two real " +
    'imports getAppModTemplate now writes, and nothing else',
  () => {
    assertEqualsSet(PROJECT_TYPE_DEPENDENCIES.app, ['@zanix/app', '@zanix/utils/logger'])
  },
)

Deno.test(
  "'@zanix/utils/logger' resolves to a real @zanix/utils subpath, same version pin convention as " +
    "'@zanix/validator'/'@zanix/types' (all three real subpaths of the same published package)",
  () => {
    // Derived from the `@zanix/validator` entry rather than a hardcoded literal: both are subpath
    // aliases of the SAME published `@zanix/utils`, meant to always move together — see the
    // `@zanix/utils/logger` entry's own comment in `dependencies.ts` ("same alias convention as
    // @zanix/validator above"). Stays correct across a version bump instead of needing a matching
    // edit here every time.
    assertEquals(
      ZANIX_DEPENDENCY_VERSIONS['@zanix/utils/logger'],
      ZANIX_DEPENDENCY_VERSIONS['@zanix/validator'].replace('/validator', '/logger'),
    )
  },
)

Deno.test(
  'other project types never regress: only app gains @zanix/utils/logger',
  () => {
    for (const [type, pkgs] of Object.entries(PROJECT_TYPE_DEPENDENCIES)) {
      if (type === 'app') continue
      assertFalse(
        (pkgs as string[]).includes('@zanix/utils/logger'),
        `${type} should not declare @zanix/utils/logger`,
      )
    }
  },
)

function assertEqualsSet(actual: string[], expected: string[]) {
  assert(actual.length === expected.length, `expected ${expected}, got ${actual}`)
  for (const pkg of expected) {
    assert(actual.includes(pkg), `expected ${actual} to include ${pkg}`)
  }
}
