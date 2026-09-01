import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@formatjs/icu-messageformat-parser'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  assertNoCompileFailures,
  compileCatalog,
  compileMessagesTree,
  MessageCompileError,
  writeCompiledCatalogs,
  writeCompiledMessagesTree,
} from 'commands/space/shared/compile-messages.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

async function writeJson(path: string, content: unknown): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, JSON.stringify(content))
}

// --- compileCatalog: golden test against parse() directly ---------------------------------------

Deno.test(
  'compileCatalog: a plain message compiles to the exact AST parse() itself produces',
  () => {
    const source = 'Welcome'
    const { welcome } = compileCatalog({ welcome: source })
    assertEquals(welcome, parse(source))
  },
)

Deno.test(
  'compileCatalog: an ICU plural compiles to the exact AST parse() itself produces',
  () => {
    const source = '{count, plural, one {# item} other {# items}}'
    const { cart } = compileCatalog({ cart: source })
    assertEquals(cart, parse(source))
  },
)

Deno.test('compileCatalog: interpolation compiles to the exact AST parse() itself produces', () => {
  const source = 'Hello, {name}!'
  const { greet } = compileCatalog({ greet: source })
  assertEquals(greet, parse(source))
})

// --- compileCatalog: mixed catalogs / idempotency ------------------------------------------------

Deno.test(
  'compileCatalog: an already-compiled (array) value passes through unchanged, never re-parsed',
  () => {
    const precompiled = parse('{count, plural, one {# item} other {# items}}')
    const result = compileCatalog({ cart: precompiled })
    assertEquals(result.cart, precompiled)
    assert(result.cart === precompiled, 'expected the exact same array reference, not a copy')
  },
)

Deno.test(
  'compileCatalog: a single catalog freely mixes string and already-compiled values',
  () => {
    const precompiled = parse('{count, plural, one {# item} other {# items}}')
    const result = compileCatalog({
      'still/source': 'Hello, {name}!',
      'already/compiled': precompiled,
    })
    assertEquals(result['still/source'], parse('Hello, {name}!'))
    assertEquals(result['already/compiled'], precompiled)
  },
)

Deno.test('compileCatalog: compiling an already-fully-compiled catalog is a no-op', () => {
  const once = compileCatalog({ greet: 'Hello, {name}!' })
  const twice = compileCatalog(once)
  assertEquals(twice, once)
})

// --- compileCatalog: fail-fast error policy ------------------------------------------------------

Deno.test(
  'compileCatalog: invalid ICU syntax throws MessageCompileError naming the exact key',
  () => {
    const error = assertThrows(
      () => compileCatalog({ greet: 'Hello, {name' }),
      MessageCompileError,
    )
    assertEquals(error.key, 'greet')
    assert(error.message.includes('greet'), 'expected the key in the error message')
  },
)

Deno.test(
  'compileCatalog: one broken key fails the WHOLE catalog — no partial output for the valid keys',
  () => {
    let result: unknown
    try {
      result = compileCatalog({ valid: 'Welcome', broken: '{name' })
    } catch (error) {
      assert(error instanceof MessageCompileError)
      assertEquals(error.key, 'broken')
    }
    assertEquals(result, undefined, 'a throw must never leave a usable partial catalog behind')
  },
)

// --- compileMessagesTree: isolation across files, not within one ---------------------------------

Deno.test(
  'compileMessagesTree: compiles every catalog found under a directory, keyed by file path',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(`${dir}/en/index.json`, { 'home/title': 'Welcome' })
      await writeJson(`${dir}/es/index.json`, { 'home/title': 'Bienvenido' })

      const result = await compileMessagesTree(dir)

      assertEquals(result.failures, [])
      assertEquals(
        Object.keys(result.compiled).sort(),
        [
          `${dir}/en/index.json`,
          `${dir}/es/index.json`,
        ].sort(),
      )
      assertEquals(result.compiled[`${dir}/en/index.json`]['home/title'], parse('Welcome'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'compileMessagesTree: one broken catalog does not stop the others in the same run from ' +
    'compiling — isolation between files',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(`${dir}/en/index.json`, { 'home/title': 'Welcome' })
      await writeJson(`${dir}/es/index.json`, { 'home/title': 'Bienvenido, {name' })
      await writeJson(`${dir}/fr/index.json`, { 'home/title': 'Bienvenue' })

      const result = await compileMessagesTree(dir)

      assertEquals(result.failures.length, 1)
      assertEquals(result.failures[0].path, `${dir}/es/index.json`)
      assert(result.failures[0].error instanceof MessageCompileError)
      assertEquals((result.failures[0].error as MessageCompileError).key, 'home/title')

      // The two VALID catalogs still compiled, despite the third one failing.
      assertEquals(
        Object.keys(result.compiled).sort(),
        [
          `${dir}/en/index.json`,
          `${dir}/fr/index.json`,
        ].sort(),
      )
      // The broken file never appears in `compiled`, not even partially.
      assert(!(`${dir}/es/index.json` in result.compiled))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'compileMessagesTree: malformed JSON is reported as a failure, not a crash of the whole run',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${dir}/en`, { recursive: true })
      await Deno.writeTextFile(`${dir}/en/index.json`, '{ not valid json')

      const result = await compileMessagesTree(dir)

      assertEquals(result.compiled, {})
      assertEquals(result.failures.length, 1)
      assertEquals(result.failures[0].path, `${dir}/en/index.json`)
      assert(result.failures[0].error.message.includes('Malformed JSON'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'compileMessagesTree: a non-object catalog (e.g. a JSON array) is reported as a failure',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await Deno.mkdir(`${dir}/en`, { recursive: true })
      await Deno.writeTextFile(`${dir}/en/index.json`, '["not", "an", "object"]')

      const result = await compileMessagesTree(dir)

      assertEquals(result.compiled, {})
      assertEquals(result.failures.length, 1)
      assert(result.failures[0].error.message.includes('flat JSON object'))
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test(
  'compileMessagesTree: accepts an array of roots, same convention as messagesDir: string[]',
  async () => {
    const dirA = await Deno.makeTempDir({ dir: TMP_ROOT })
    const dirB = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(`${dirA}/en/index.json`, { a: 'From A' })
      await writeJson(`${dirB}/es/index.json`, { a: 'From B' })

      const result = await compileMessagesTree([dirA, dirB])

      assertEquals(result.failures, [])
      assertEquals(
        Object.keys(result.compiled).sort(),
        [
          `${dirA}/en/index.json`,
          `${dirB}/es/index.json`,
        ].sort(),
      )
    } finally {
      await Deno.remove(dirA, { recursive: true })
      await Deno.remove(dirB, { recursive: true })
    }
  },
)

// --- assertNoCompileFailures ----------------------------------------------------------------------

Deno.test('assertNoCompileFailures: a no-op when there are no failures', () => {
  assertNoCompileFailures({ compiled: {}, failures: [] })
})

Deno.test(
  'assertNoCompileFailures: throws one aggregate error naming every failed file and reason',
  () => {
    const error = assertThrows(
      () =>
        assertNoCompileFailures({
          compiled: {},
          failures: [
            { path: '/messages/en/index.json', error: new Error('bad key') },
            { path: '/messages/es/index.json', error: new Error('also bad') },
          ],
        }),
      Error,
    )
    assert(error.message.includes('2 message catalog(s)'))
    assert(error.message.includes('/messages/en/index.json'))
    assert(error.message.includes('bad key'))
    assert(error.message.includes('/messages/es/index.json'))
    assert(error.message.includes('also bad'))
  },
)

// --- writeCompiledMessagesTree / writeCompiledCatalogs ---------------------------------------------

Deno.test(
  'writeCompiledMessagesTree: writes to {outDir}/messages/0/... for a single-root messagesDir, ' +
    'and the source file itself is left untouched',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const outDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(`${dir}/en/index.json`, { title: 'Welcome' })

      const written = await writeCompiledMessagesTree(dir, outDir)

      assertEquals(written, [`${outDir}/messages/0/en/index.json`])
      const compiled = JSON.parse(await Deno.readTextFile(`${outDir}/messages/0/en/index.json`))
      assertEquals(compiled, { title: parse('Welcome') })

      const source = JSON.parse(await Deno.readTextFile(`${dir}/en/index.json`))
      assertEquals(source, { title: 'Welcome' })
    } finally {
      await Deno.remove(dir, { recursive: true })
      await Deno.remove(outDir, { recursive: true })
    }
  },
)

Deno.test(
  'writeCompiledMessagesTree(messagesDir[]): each root writes under its own ARRAY INDEX ' +
    'subdirectory — 0 for the first root, 1 for the second, preserving which root a file came from',
  async () => {
    const rootA = await Deno.makeTempDir({ dir: TMP_ROOT })
    const rootB = await Deno.makeTempDir({ dir: TMP_ROOT })
    const outDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(`${rootA}/en/populations/zanix.json`, { title: 'Override' })
      await writeJson(`${rootB}/en/index.json`, { title: 'Base' })

      const written = await writeCompiledMessagesTree([rootA, rootB], outDir)

      assertEquals(
        written.sort(),
        [
          `${outDir}/messages/0/en/populations/zanix.json`,
          `${outDir}/messages/1/en/index.json`,
        ].sort(),
      )
    } finally {
      await Deno.remove(rootA, { recursive: true })
      await Deno.remove(rootB, { recursive: true })
      await Deno.remove(outDir, { recursive: true })
    }
  },
)

Deno.test(
  'writeCompiledCatalogs: writes an already-compiled result without re-compiling — a caller ' +
    'that already ran compileMessagesTree/assertNoCompileFailures separately (e.g. to straddle a ' +
    'step that empties outDir) gets the same destination layout',
  async () => {
    const dir = await Deno.makeTempDir({ dir: TMP_ROOT })
    const outDir = await Deno.makeTempDir({ dir: TMP_ROOT })
    try {
      await writeJson(`${dir}/en/index.json`, { title: 'Welcome' })
      const result = await compileMessagesTree(dir)
      assertNoCompileFailures(result)

      const written = await writeCompiledCatalogs(result, dir, outDir)

      assertEquals(written, [`${outDir}/messages/0/en/index.json`])
      const compiled = JSON.parse(await Deno.readTextFile(`${outDir}/messages/0/en/index.json`))
      assertEquals(compiled, { title: parse('Welcome') })
    } finally {
      await Deno.remove(dir, { recursive: true })
      await Deno.remove(outDir, { recursive: true })
    }
  },
)
