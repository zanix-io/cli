import { assertEquals, assertStringIncludes } from '@std/assert'
import { pinImportMeta } from 'commands/space/shared/pin-import-meta.ts'

const ORIGINAL = 'file:///project/src/forms/toast.comet.tsx'

Deno.test(
  'pinImportMeta: import.meta.url and import.meta.filename become the original file, as string ' +
    'literals',
  () => {
    const pinned = pinImportMeta(
      'export default defineComet(Toast, import.meta.url)\nexport const f = import.meta.filename\n',
      ORIGINAL,
    )
    assertEquals(
      pinned,
      `export default defineComet(Toast, "${ORIGINAL}")\n` +
        'export const f = "/project/src/forms/toast.comet.tsx"\n',
    )
  },
)

Deno.test(
  'pinImportMeta: a relative reference keeps resolving against the original directory',
  () => {
    const pinned = pinImportMeta(`const u = new URL('./data.json', import.meta.url)\n`, ORIGINAL)
    assertEquals(pinned, `const u = new URL('./data.json', "${ORIGINAL}")\n`)
    // The copy lives in the original's own directory, so both bases give the same result.
    const fromCopy = new URL('./data.json', 'file:///project/src/forms/.zanix-import-1.js').href
    assertEquals(new URL('./data.json', ORIGINAL).href, fromCopy)
  },
)

Deno.test(
  'pinImportMeta: dirname, resolve and main are left as they are, and so is code with no import.meta',
  () => {
    const code = 'const a = import.meta.dirname\nconst b = import.meta.resolve("./x")\n' +
      'if (import.meta.main) run()\n'
    assertEquals(pinImportMeta(code, ORIGINAL), code)
    assertEquals(pinImportMeta('export const x = 1\n', ORIGINAL), 'export const x = 1\n')
  },
)

Deno.test(
  'pinImportMeta: the same text in a comment or a string is not an import.meta expression and is ' +
    'not touched',
  () => {
    const code = '// see import.meta.url\n/* import.meta.filename */\n' +
      `const s = "import.meta.url"\nconst t = \`import.meta.url\`\nexport const u = import.meta.url\n`
    const pinned = pinImportMeta(code, ORIGINAL)
    assertStringIncludes(pinned, '// see import.meta.url\n/* import.meta.filename */')
    assertStringIncludes(pinned, 'const s = "import.meta.url"')
    assertStringIncludes(pinned, 'const t = `import.meta.url`')
    assertStringIncludes(pinned, `export const u = "${ORIGINAL}"`)
  },
)

Deno.test('pinImportMeta: every occurrence is pinned, whitespace around the dots included', () => {
  const pinned = pinImportMeta(
    'const a = import.meta.url, b = import . meta . url, c = import.meta.url.length\n',
    ORIGINAL,
  )
  assertEquals(
    pinned,
    `const a = "${ORIGINAL}", b = "${ORIGINAL}", c = "${ORIGINAL}".length\n`,
  )
})

Deno.test('pinImportMeta: a property that only starts with url or filename is not pinned', () => {
  const code = 'const a = import.meta.urlish\nconst b = import.meta.filenames\n'
  assertEquals(pinImportMeta(code, ORIGINAL), code)
})
