import { assertEquals } from '@std/assert'
import { analyzeSource } from 'commands/check-cycles/lib/side-effects/analyze-file.ts'

// Locks in the real fix at `analyze-file.ts`'s `ClassDeclaration`/`ClassExpression` case: a
// class's `extends` clause evaluates the moment the class itself is declared, not when it's later
// instantiated — the exact same TDZ-risk shape as a top-level function call. Confirmed real, not
// hypothetical: `@zanix/utils`'s own `logger/mod.ts` — `export class Logger extends
// LoggerMainClass {}`, `LoggerMainClass` imported from `logger/main.ts` — is precisely this
// pattern. Before the fix, the AST walker had no `ClassDeclaration`/`ClassExpression` case at all,
// so it fell through to `default` (`CONTAINER_CHILD_KEYS[node.type]` is `undefined` for a class
// node — no `hasExecutableEffect`, nothing walked), meaning this exact shape was silently invisible
// to `check-cycles`.

Deno.test(
  'analyzeSource flags `class X extends Y` as a risky top-level statement when Y is imported',
  () => {
    const source = [
      `import { Base } from './base.ts'`,
      ``,
      `export class Derived extends Base {}`,
      ``,
    ].join('\n')

    const result = analyzeSource('/repo/derived.ts', source)

    assertEquals(result.riskyStatements.length, 1)
    assertEquals(result.riskyStatements[0].identifiers, ['Base'])
    assertEquals(result.imports['Base'], './base.ts')
  },
)

Deno.test(
  'analyzeSource does NOT flag a class declaration with no `extends` clause (no false positive)',
  () => {
    const source = [
      `import { Base } from './base.ts'`,
      ``,
      `export class Derived {}`,
      ``,
    ].join('\n')

    const result = analyzeSource('/repo/derived.ts', source)

    assertEquals(result.riskyStatements.length, 0)
  },
)

Deno.test(
  'analyzeSource flags a `class X extends Y` ClassExpression the same way as a declaration',
  () => {
    const source = [
      `import { Base } from './base.ts'`,
      ``,
      `const Derived = class extends Base {}`,
      ``,
    ].join('\n')

    const result = analyzeSource('/repo/derived.ts', source)

    assertEquals(result.riskyStatements.length, 1)
    assertEquals(result.riskyStatements[0].identifiers, ['Base'])
  },
)
