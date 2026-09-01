import { baseZnxConfig, generateImports, LINTER_BASE_RULES } from 'utils/config/base.ts'
import {
  THIRD_PARTY_DEPENDENCY_VERSIONS,
  ZANIX_DEPENDENCY_VERSIONS,
} from 'utils/config/dependencies.ts'
import { getTemporaryFolder } from '@zanix/helpers'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'
import { assert, assertEquals, assertExists } from '@std/assert'
import { saveZanixConfig } from 'utils/config/main.ts'
import { fromFileUrl } from '@std/path'
import { stub } from '@std/testing/mock'

Deno.test('generateImports should create correct import mappings', () => {
  const mockFolders = {
    subfolders: {
      utils: { FOLDER: 'src/utils' },
      components: { FOLDER: 'src/components' },
      zanixText: { FOLDER: fromFileUrl(import.meta.url) },
    },
  }

  const imports = generateImports(mockFolders)

  assertEquals(imports['utils/'], './src/utils/')
  assertEquals(imports['components/'], './src/components/')
  assertEquals(
    imports['zanix.test.ts/'],
    './src/@tests/integration/zanix.test.ts/',
  )
})

Deno.test('generateImports should skip falsy subfolder entries', () => {
  const mockFolders = {
    subfolders: {
      utils: { FOLDER: 'src/utils' },
      missing: undefined,
    },
  }

  const imports = generateImports(mockFolders)

  assertEquals(imports, { 'utils/': './src/utils/' })
})

// `getZanixPaths`'s underlying `getCommonTree`/`getServerSrcTree`/etc. cache their computed tree
// per-root at module scope (moved verbatim from `@zanix/utils`, unrelated to this migration's
// scope) — the cache key doesn't account for `type`, so calling `baseZnxConfig` with a different
// `type` but the same implicit `Deno.cwd()` root inside the same process returns a stale,
// wrong-shaped cached tree. Each test below stubs `Deno.cwd()` to its own unique root so no two
// tests in this suite ever share a cache entry, regardless of file/test execution order.
let rootCounter = 0
function stubUniqueRoot() {
  const root = `/zanix-test-root-${rootCounter++}`
  return stub(Deno, 'cwd', () => root)
}

Deno.test('baseZnxConfig should return a valid config object for space projects', () => {
  const cwdMock = stubUniqueRoot()
  try {
    const config = baseZnxConfig('space')
    const dist = getZanixPaths().subfolders['.dist'].NAME

    assert(config.zanix?.project === 'space')
    assertEquals(config.compilerOptions?.jsx, 'react-jsx')
    assertEquals(config.compilerOptions?.jsxImportSource, 'react')
    assert(config.lint?.rules?.tags?.includes('react'))
    assertExists(config.name)
    assertExists(config.compilerOptions)
    assertEquals(config.lint?.exclude?.[0], dist)
    assertEquals(config.fmt?.exclude?.[0], dist)
    assertEquals(config.imports, {
      'space/': './src/space/',
      'shared/': './src/shared/',
      'typings/': './src/typings/',
      'utils/': './src/utils/',
      '@zanix/space': ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
      '@zanix/app/runtime': ZANIX_DEPENDENCY_VERSIONS['@zanix/app/runtime'],
      'babel-plugin-react-compiler': THIRD_PARTY_DEPENDENCY_VERSIONS['babel-plugin-react-compiler'],
      react: THIRD_PARTY_DEPENDENCY_VERSIONS.react,
    })
  } finally {
    cwdMock.restore()
  }
})

Deno.test('baseZnxConfig should return a valid config object for library projects', () => {
  const cwdMock = stubUniqueRoot()
  try {
    const config = baseZnxConfig('library')
    assert(config.zanix?.project === 'library')

    assertEquals(config.lint?.rules?.tags, ['recommended', 'jsr'])
    assertEquals(config.publish?.exclude, ['.github', 'src/@tests'])
    assertEquals(config.imports, {
      'modules/': './src/modules/',
      'shared/': './src/shared/',
      'typings/': './src/typings/',
      'utils/': './src/utils/',
    })
  } finally {
    cwdMock.restore()
  }
})

Deno.test('baseZnxConfig should return a valid config object for space-server projects', () => {
  const cwdMock = stubUniqueRoot()
  try {
    const config = baseZnxConfig('space-server')

    assert(config.zanix?.project === 'space-server')
    assert(config.publish?.exclude === undefined)
    assertEquals(config.lint?.rules?.tags, [
      'recommended',
      'jsr',
      'react',
      'jsx',
    ])
    assertEquals(config.imports, {
      'space/': './src/space/',
      'server/': './src/server/',
      'shared/': './src/shared/',
      'typings/': './src/typings/',
      'utils/': './src/utils/',
      '@zanix/space': ZANIX_DEPENDENCY_VERSIONS['@zanix/space'],
      '@zanix/server': ZANIX_DEPENDENCY_VERSIONS['@zanix/server'],
      '@zanix/datamaster': ZANIX_DEPENDENCY_VERSIONS['@zanix/datamaster'],
      '@zanix/asyncmq': ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq'],
      '@zanix/asyncmq/jobs': ZANIX_DEPENDENCY_VERSIONS['@zanix/asyncmq/jobs'],
      '@zanix/validator': ZANIX_DEPENDENCY_VERSIONS['@zanix/validator'],
      '@zanix/core': ZANIX_DEPENDENCY_VERSIONS['@zanix/core'],
      'babel-plugin-react-compiler': THIRD_PARTY_DEPENDENCY_VERSIONS['babel-plugin-react-compiler'],
      react: THIRD_PARTY_DEPENDENCY_VERSIONS.react,
    })
  } finally {
    cwdMock.restore()
  }
})

Deno.test('saveZanixConfig should write a valid config file', async () => {
  // Mock config
  const temporaryFolder = getTemporaryFolder(import.meta.url)
  const mockFileConfig = temporaryFolder + '/deno.jsonc'
  await Deno.writeTextFile(mockFileConfig, '{}')
  const mockCwd = stub(Deno, 'cwd', () => temporaryFolder)

  await saveZanixConfig('library')
  const file = JSON.parse(await Deno.readTextFile(mockFileConfig))

  assert(file.zanix.project === 'library')
  assert(file.lint.rules.tags[0] === 'recommended')
  assert(file.lint.plugins[0] === ZANIX_DEPENDENCY_VERSIONS['@zanix/utils/linter'])
  assertExists(file.name)
  assertExists(file.fmt)
  assertExists(file.lint)

  await Deno.remove(mockFileConfig)
  mockCwd.restore()
})

Deno.test('saveZanixConfig should update an existing config file', async () => {
  // Mock config
  const temporaryFolder = getTemporaryFolder(import.meta.url)
  const mockFileConfig = temporaryFolder + '/deno.jsonc'
  await Deno.writeTextFile(
    mockFileConfig,
    JSON.stringify({
      'name': '@zanix/utils',
      'version': '1.0.0',
      'license': 'MIT',
      'compilerOptions': {
        'strict': false,
      },
      'exports': { '.': './mod.ts' },
      'lint': {
        'rules': {
          'tags': ['recommended'],
          'include': ['other-rule', 'eqeqeq'],
        },
        'exclude': ['.some'],
        'plugins': ['./other/plugin.ts'],
        'report': 'pretty',
      },
      'fmt': {
        'exclude': [],
        'proseWrap': 'always',
        'indentWidth': 1,
        'singleQuote': false,
        'lineWidth': 100,
        'useTabs': false,
        'semiColons': false,
      },
      'imports': {
        '@std/assert': 'jsr:@std/assert@0.224',
        '@std/fmt': 'jsr:@std/fmt@0.224',
        'example/': './src/linter/',
        'typings/': './src/typings/',
      },
      'publish': { 'exclude': ['myOwn'], 'other': 1 },
    }),
  )

  const mockCwd = stub(Deno, 'cwd', () => temporaryFolder)

  await saveZanixConfig('library')
  const file = JSON.parse(await Deno.readTextFile(mockFileConfig))

  assert(file.zanix.project === 'library')
  assertEquals(file.compilerOptions, {
    'strict': false,
    'noImplicitAny': true,
  })
  assertEquals(file.zanix, {
    'project': 'library',
  })
  assertExists(file.name)
  assert(file.imports['@tests/'] === undefined)

  assertEquals(file.lint.rules.tags, ['recommended', 'jsr'])

  assertEquals(file.publish.other, 1)
  assertEquals(file.publish.exclude, ['myOwn', '.github', 'src/@tests'])
  assertEquals(file.fmt, {
    'exclude': [],
    'proseWrap': 'always',
    'indentWidth': 2,
    'singleQuote': true,
    'lineWidth': 100,
    'useTabs': false,
    'semiColons': false,
  })

  assertEquals(file.lint.rules.include, ['other-rule', ...LINTER_BASE_RULES])
  assert(
    file.lint.plugins.includes(ZANIX_DEPENDENCY_VERSIONS['@zanix/utils/linter']),
  )
  assertExists(file.imports['typings/'])
  assertExists(file.imports['modules/'])
  assertExists(file.imports['shared/'])
  assertExists(file.imports['utils/'])
  assertExists(file.imports['example/'])

  await Deno.remove(mockFileConfig)
  mockCwd.restore()
})
