import { assert } from '@std/assert'

/**
 * Structural guard rails for `compile-messages.ts`'s own dependency boundary, verified via
 * `deno info --json`'s actual resolved module graph — transitive reachability, not a grep over
 * `deno.jsonc`'s own `imports` map. Mirrors `@zanix/space-ui`'s own
 * `dependency-boundary.test.ts`, same technique, same reasoning.
 *
 * This module is not yet wired into `commands/mod.ts`'s own eagerly-imported command surface (see
 * `compile-messages.ts`'s own module doc — that wiring is Fase 3, not this one), so its own file is
 * the graph root checked here, not `cli`'s `mod.ts`.
 *
 * @module
 */

const ENTRY = 'src/commands/space/shared/compile-messages.ts'

interface ModuleGraph {
  code: Set<string>
  type: Set<string>
}

async function moduleGraph(entry: string): Promise<ModuleGraph> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }

  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const code = new Set<string>()
  const type = new Set<string>()
  for (const module of parsed.modules ?? []) {
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) code.add(dep.code.specifier)
      if (dep.type?.specifier) type.add(dep.type.specifier)
    }
  }
  return { code, type }
}

function includesPackage(specifiers: Set<string>, pkg: string): boolean {
  return [...specifiers].some((specifier) => {
    if (!specifier.startsWith('npm:')) return false
    const rest = specifier.slice('npm:'.length).replace(/^\//, '')
    return rest === pkg || rest.startsWith(`${pkg}@`) || rest.startsWith(`${pkg}/`)
  })
}

Deno.test(
  'compile-messages.ts: reaches the ICU parser as a real code dependency (positive graph check)',
  async () => {
    const graph = await moduleGraph(ENTRY)
    assert(
      includesPackage(graph.code, '@formatjs/icu-messageformat-parser'),
      'expected @formatjs/icu-messageformat-parser as a real, code-level dependency of the compiler',
    )
  },
)

Deno.test(
  'compile-messages.ts: never reaches @formatjs/intl — the CLI compiles, space-ui consumes',
  async () => {
    const graph = await moduleGraph(ENTRY)
    assert(!includesPackage(graph.code, '@formatjs/intl'))
    assert(!includesPackage(graph.type, '@formatjs/intl'))
  },
)

Deno.test(
  'compile-messages.ts: never reaches react or preact, at compile time or runtime',
  async () => {
    const graph = await moduleGraph(ENTRY)
    for (const pkg of ['react', 'react-dom', 'preact', 'preact/compat']) {
      assert(!includesPackage(graph.code, pkg), `${pkg} leaked into the compiler as code`)
      assert(!includesPackage(graph.type, pkg), `${pkg} leaked into the compiler as a type`)
    }
  },
)
