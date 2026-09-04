import type {
  FileAnalysis,
  RiskyTopLevelStatement,
} from 'commands/check-cycles/lib/side-effects/types.ts'

// deno-lint-ignore no-explicit-any
type LintNode = any

/**
 * Container node types whose children are safe to walk unconditionally — the value(s) at each
 * listed key are either a single node or an array of nodes (possibly containing `null`, e.g. a
 * missing `alternate` on an `IfStatement`). Deliberately excludes `FunctionDeclaration`/
 * `FunctionExpression`/`ArrowFunctionExpression`/`ClassDeclaration`/`ClassExpression` — their
 * bodies don't run at module-evaluation time UNLESS actually invoked, which `walk()` handles as a
 * special case (see its own doc), not by including them here.
 */
const CONTAINER_CHILD_KEYS: Record<string, string[]> = {
  Program: ['body'],
  BlockStatement: ['body'],
  ExpressionStatement: ['expression'],
  VariableDeclaration: ['declarations'],
  VariableDeclarator: ['init'],
  ReturnStatement: ['argument'],
  IfStatement: ['test', 'consequent', 'alternate'],
  NewExpression: ['callee', 'arguments'],
  AwaitExpression: ['argument'],
  ChainExpression: ['expression'],
  ObjectExpression: ['properties'],
  Property: ['value'],
  ArrayExpression: ['elements'],
  SpreadElement: ['argument'],
  TemplateLiteral: ['expressions'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  BinaryExpression: ['left', 'right'],
  LogicalExpression: ['left', 'right'],
  UnaryExpression: ['argument'],
  AssignmentExpression: ['left', 'right'],
  ExportDefaultDeclaration: ['declaration'],
  ExportNamedDeclaration: ['declaration'],
  SequenceExpression: ['expressions'],
  TSAsExpression: ['expression'],
  TSNonNullExpression: ['expression'],
  TSSatisfiesExpression: ['expression'],
}

/** Local top-level function name -> its body node (`BlockStatement`, or a concise arrow's direct
 * expression body), collected once per file up front. */
type TopLevelFunctions = Map<string, LintNode>

type WalkState = {
  hasExecutableEffect: boolean
  identifiers: Set<string>
  /** Guards against infinite recursion when following a locally-called top-level function's body
   * (a self- or mutually-recursive local helper). */
  visitedFunctions: Set<string>
  topLevelFunctions: TopLevelFunctions
}

/**
 * Walks an expression/statement subtree, collecting every identifier reference and whether the
 * subtree executes something (a call, a `new`, an `await`) — the two facts needed to tell whether
 * a top-level statement is a real risky side effect, and what it touches.
 *
 * The one deliberate gap: an immediately-invoked function expression's own body is never
 * descended into (`FunctionExpression`/`ArrowFunctionExpression` aren't in
 * `CONTAINER_CHILD_KEYS`, and `CallExpression`'s own case below only follows a NAMED local
 * function found in `topLevelFunctions`, never an inline function literal being called directly).
 * No real instance of that shape exists anywhere in this ecosystem today (every real eager-
 * registration precedent calls a named top-level function) — if one appears, this needs
 * extending to also follow a `CallExpression` whose own `callee` is itself a
 * `FunctionExpression`/`ArrowFunctionExpression`.
 */
function walk(node: LintNode, state: WalkState): void {
  if (node === null) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, state)
    return
  }
  if (typeof node !== 'object' || typeof node.type !== 'string') return

  switch (node.type) {
    case 'Identifier':
      state.identifiers.add(node.name)
      return

    case 'MemberExpression':
      // `object` is always a real reference; `property` only is when the access is computed
      // (`obj[x]`) — `obj.x`'s `property` is a property NAME, not a variable reference, and
      // must never be treated as one (a property named the same as a real import's local
      // binding would otherwise produce a false cross-reference).
      walk(node.object, state)
      if (node.computed) walk(node.property, state)
      return

    case 'CallExpression': {
      state.hasExecutableEffect = true
      walk(node.callee, state)
      walk(node.arguments, state)

      const calleeName = node.callee?.type === 'Identifier' ? node.callee.name : undefined
      if (
        calleeName && state.topLevelFunctions.has(calleeName) &&
        !state.visitedFunctions.has(calleeName)
      ) {
        state.visitedFunctions.add(calleeName)
        walk(state.topLevelFunctions.get(calleeName), state)
      }
      return
    }

    case 'NewExpression':
    case 'AwaitExpression':
      state.hasExecutableEffect = true
      for (const key of CONTAINER_CHILD_KEYS[node.type]) walk(node[key], state)
      return

    case 'ClassDeclaration':
    case 'ClassExpression':
      // A class's `extends` clause evaluates the moment the class itself is declared, not when
      // it's later instantiated — the exact same TDZ-risk shape as a top-level function call.
      // Confirmed real, not hypothetical: `@zanix/utils`'s own `logger/mod.ts` —
      // `export class Logger extends LoggerMainClass {}` (`LoggerMainClass` imported from
      // `logger/main.ts`) — is precisely this pattern, currently safe only because `main.ts`
      // happens to finish evaluating before this file's own `extends` clause runs, in today's
      // real load order. The class BODY (methods) stays deferred until called — never walked
      // here, same reasoning as a function body only walked when the `CallExpression` case
      // above follows a real invocation.
      if (node.superClass) {
        state.hasExecutableEffect = true
        walk(node.superClass, state)
      }
      return

    case 'Property':
      // A shorthand `{ foo }` has `key`/`value` as the SAME identifier node — walking `value`
      // alone (already in the table) covers both cases without double-counting.
      walk(node.value, state)
      return

    default: {
      const keys = CONTAINER_CHILD_KEYS[node.type]
      if (!keys) return // Unhandled node type (or a deliberately-excluded function/class body) — stop here.
      for (const key of keys) walk(node[key], state)
    }
  }
}

/** Collects every top-level `const X = (...) => {...}` / `function X(...) {...}` (bare or
 * `export`ed) declared directly in `Program.body`, keyed by name — the set `walk()`'s
 * `CallExpression` case can follow into when a top-level statement calls one of them. */
function collectTopLevelFunctions(programBody: LintNode[]): TopLevelFunctions {
  const functions: TopLevelFunctions = new Map()

  const record = (statement: LintNode) => {
    if (statement.type === 'VariableDeclaration') {
      for (const decl of statement.declarations) {
        const init = decl.init
        if (
          decl.id?.type === 'Identifier' &&
          (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')
        ) {
          functions.set(decl.id.name, init.body)
        }
      }
    } else if (statement.type === 'FunctionDeclaration' && statement.id?.type === 'Identifier') {
      functions.set(statement.id.name, statement.body)
    }
  }

  for (const statement of programBody) {
    if (statement.type === 'ExportNamedDeclaration' && statement.declaration) {
      record(statement.declaration)
    } else {
      record(statement)
    }
  }

  return functions
}

/** `local name -> raw import specifier`, from every `ImportDeclaration` in `Program.body`. */
function collectImports(programBody: LintNode[]): Record<string, string> {
  const imports: Record<string, string> = {}

  for (const statement of programBody) {
    if (statement.type !== 'ImportDeclaration') continue
    const source = statement.source?.value
    if (typeof source !== 'string') continue

    for (const specifier of statement.specifiers ?? []) {
      const localName = specifier.local?.name
      if (typeof localName === 'string') imports[localName] = source
    }
  }

  return imports
}

/**
 * Analyzes one file's real source for the intra-package circular-import hazard's second
 * ingredient: a top-level (module-scope) statement that executes something and, in doing so,
 * reads an identifier this file imported from elsewhere, while that identifier's own source file
 * is still mid-cycle (and so may not have finished initializing it yet).
 *
 * Must be called from inside a `Deno.test()` callback — `Deno.lint.runPlugin` (the only fully
 * Deno-native way to get a real AST, with no third-party parser dependency) is only available in
 * that context; calling this outside `deno test` throws.
 */
export function analyzeSource(file: string, source: string): FileAnalysis {
  const riskyStatements: RiskyTopLevelStatement[] = []
  let topLevelFunctions: TopLevelFunctions = new Map()
  let imports: Record<string, string> = {}

  const plugin: Deno.lint.Plugin = {
    name: 'check-cycles-side-effects',
    rules: {
      'check-cycles-side-effects': {
        create() {
          return {
            Program(programNode) {
              const body = programNode.body as LintNode[]
              topLevelFunctions = collectTopLevelFunctions(body)
              imports = collectImports(body)

              for (const statement of body) {
                const state: WalkState = {
                  hasExecutableEffect: false,
                  identifiers: new Set(),
                  visitedFunctions: new Set(),
                  topLevelFunctions,
                }
                walk(statement, state)

                if (state.hasExecutableEffect) {
                  const line = (statement.range?.[0] !== null)
                    ? lineFromOffset(source, statement.range[0])
                    : 0
                  riskyStatements.push({ line, identifiers: [...state.identifiers] })
                }
              }
            },
          }
        },
      },
    },
  }

  Deno.lint.runPlugin(plugin, file, source)

  return { file, riskyStatements, imports }
}

function lineFromOffset(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++
  }
  return line
}
