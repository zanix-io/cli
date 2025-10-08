import { baseZnxConfig, generateImports, linterBaseRules } from 'utils/config/base.ts'
import { getTemporaryFolder, getZanixPaths } from '@zanix/helpers'
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
  assertEquals(imports['zanix.test.ts/'], './src/@tests/integration/zanix.test.ts/')
})

Deno.test('baseZnxConfig should return a valid config object for app projects', () => {
  const config = baseZnxConfig('app')
  const dist = getZanixPaths().subfolders['.dist'].NAME

  assert(config.zanix?.project === 'app')
  assertEquals(config.compilerOptions?.jsx, 'react')
  assert(config.lint?.rules?.tags?.includes('react'))
  assertExists(config.name)
  assertExists(config.compilerOptions)
  assertEquals(config.lint?.exclude?.[0], dist)
  assertEquals(config.fmt?.exclude?.[0], dist)
  assertEquals(config.imports, {
    'app/': './src/app/',
    'shared/': './src/shared/',
    'typings/': './src/typings/',
    'utils/': './src/utils/',
  })
})

Deno.test('baseZnxConfig should return a valid config object for library projects', () => {
  const config = baseZnxConfig('library')
  assert(config.zanix?.project === 'library')

  assertEquals(config.lint?.rules?.tags, ['recommended', 'jsr'])
  assertEquals(config.publish?.exclude, ['.github', 'src/@tests'])
  assertExists(config.zanix.hash)
  assertEquals(config.imports, {
    'modules/': './src/modules/',
    'shared/': './src/shared/',
    'typings/': './src/typings/',
    'utils/': './src/utils/',
  })
})

Deno.test('baseZnxConfig should return a valid config object for app-server projects', () => {
  const config = baseZnxConfig('app-server')

  assert(config.zanix?.project === 'app-server')
  assert(config.publish?.exclude === undefined)
  assertExists(config.zanix.hash)
  assertEquals(config.lint?.rules?.tags, ['recommended', 'jsr', 'react', 'jsx'])
  assertEquals(config.imports, {
    'app/': './src/app/',
    'server/': './src/server/',
    'shared/': './src/shared/',
    'typings/': './src/typings/',
    'utils/': './src/utils/',
  })
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
  assert(file.lint.plugins[0] === 'jsr:@zanix/utils/linter/deno-zanix-plugin')
  assertExists(file.zanix.hash)
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
    'hash': 'zu226a',
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

  assertEquals(file.lint.rules.include, ['other-rule', ...linterBaseRules])
  assert(file.lint.plugins.includes('jsr:@zanix/utils/linter/deno-zanix-plugin'))
  assertExists(file.imports['typings/'])
  assertExists(file.imports['modules/'])
  assertExists(file.imports['shared/'])
  assertExists(file.imports['utils/'])
  assertExists(file.imports['example/'])

  await Deno.remove(mockFileConfig)
  mockCwd.restore()
})
