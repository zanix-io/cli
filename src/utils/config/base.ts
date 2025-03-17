import type { ConfigFile, ZanixProjects } from '@zanix/types'

import { getFolderName, getRelativePath, getZanixPaths } from '@zanix/helpers'
import { MAIN_MODULE } from '@zanix/utils/constants'

export const linterBaseRules = [
  'eqeqeq',
  'default-param-last',
  'camelcase',
  'no-await-in-loop',
  'no-const-assign',
  'no-eval',
  'no-non-null-asserted-optional-chain',
  'no-non-null-assertion',
  'no-self-compare',
  'no-sync-fn-in-async-fn',
  'no-throw-literal',
  'no-useless-rename',
]

/**
 * Generates a hash string for a given Zanix project name.
 *
 * @param name - The full project name, potentially in the form '@proyect/name'.
 * @returns A lowercase hash string
 */
export const generateZanixHash = (name: string): string => {
  const [[orgInitial, ...orgLetters], projectName] = name.replace('@', '').split('/')

  const projectInitials = projectName
    ? projectName.split('-').map((word) => word[0]).join('')
    : orgInitial

  let hashCode = 0
  for (let i = 0; i < name.length; i++) {
    hashCode += name.charCodeAt(i)
  }

  const hash = Math.abs(hashCode % 1000).toString()
  const result = `${orgInitial}${projectInitials}${hash}`.toLowerCase()

  return result.padEnd(6, ...orgLetters)
}

/**
 * Generate imports or alias for zanix project structure
 * @param folders - Record folder names
 */
export function generateImports(
  // deno-lint-ignore no-explicit-any
  folders: Record<string, any>,
  testsPath?: string,
) {
  const imports: Record<string, string> = {}

  Object.keys(folders.subfolders).forEach((key) => {
    const folder = folders.subfolders[key]
    if (!folder) return
    const name = folder.NAME || getFolderName(folder.FOLDER)
    if (name === testsPath) return
    imports[`${name}/`] = getRelativePath(folder.FOLDER)
  })

  return imports
}

/**
 * Define a base `deno` configuration file
 * @param type - Zanix project type (`server`, `app`, `app-server` or `library`)
 */
export function baseZnxConfig(type: ZanixProjects): ConfigFile {
  const paths = getZanixPaths(type)
  const znxMainFolders = paths.subfolders
  const dist = znxMainFolders['.dist'].NAME
  const name = '@project/name'
  const testsPaths = znxMainFolders.src.subfolders['@tests']
  const imports = generateImports(znxMainFolders.src, testsPaths.NAME)
  const linterTags = ['recommended', 'jsr']
  const compilerOptions: ConfigFile['compilerOptions'] = {
    strict: true,
    noImplicitAny: true,
  }
  const libraryOpts: Record<string, unknown> = {}
  const tests = testsPaths.FOLDER.replace(paths.FOLDER, '')

  if (type === 'app' || type === 'app-server') {
    linterTags.push(...['react', 'jsx'])
    compilerOptions.jsx = 'react'
  }
  if (type === 'library') {
    libraryOpts.exports = { '.': `./${MAIN_MODULE}` }
    libraryOpts.publish = {
      exclude: ['.github', tests],
    }
  }

  return {
    name,
    zanix: {
      project: type,
      hash: generateZanixHash(name),
    },
    compilerOptions,
    lint: {
      rules: {
        tags: linterTags,
        include: linterBaseRules,
      },
      exclude: [dist],
      plugins: [
        'jsr:@zanix/utils/linter/deno-zanix-plugin',
      ],
      report: 'pretty',
    },
    fmt: {
      exclude: [dist],
      proseWrap: 'always',
      indentWidth: 2,
      singleQuote: true,
      lineWidth: 100,
      useTabs: false,
      semiColons: false,
    },
    imports,
    ...libraryOpts,
    test: {
      include: [
        `${tests}/**/*.test.ts`,
      ],
    },
  }
}
