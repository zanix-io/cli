import type { ConfigFile } from '@zanix/types'

import { generateZanixHash } from './base.ts'

/** Function to adapt current config to base config */
export const configAdaptation = (currentConfig: ConfigFile, config: ConfigFile) => {
  const newConfig = (Object.keys(currentConfig).length > 0) ? { ...currentConfig } : { ...config }

  newConfig.compilerOptions = {
    ...config.compilerOptions,
    ...currentConfig.compilerOptions,
  } as ConfigFile['compilerOptions']

  newConfig.zanix = {
    ...config.zanix,
    ...currentConfig.zanix,
    project: config.zanix?.project,
    hash: currentConfig.name ? generateZanixHash(currentConfig.name) : config.zanix?.hash,
  }

  //  Format rules to be overriden

  const fmt = config.fmt || {}
  newConfig.fmt = {
    ...fmt,
    ...currentConfig.fmt,
    indentWidth: fmt.indentWidth,
    lineWidth: fmt.lineWidth,
    singleQuote: fmt.singleQuote,
    semiColons: fmt.semiColons,
  }

  //  Linter config to be overriden

  const lint = config.lint || {}

  const currentLinterTags = currentConfig.lint?.rules?.tags || []
  const baseLinterTags = lint.rules?.tags || []
  const linterTags = Array.from(new Set([...currentLinterTags, ...baseLinterTags]))

  const currentIncludes = currentConfig.lint?.rules?.include || []
  const baseIncludes = lint.rules?.include || []
  const linterInclude = Array.from(new Set([...currentIncludes, ...baseIncludes]))

  const currentPlugins = currentConfig.lint?.plugins || []
  const basePlugins = lint.plugins || []
  const linterPlugins = Array.from(new Set([...currentPlugins, ...basePlugins]))

  newConfig.lint = {
    ...lint,
    ...currentConfig.lint,
    rules: {
      ...currentConfig.lint?.rules,
      tags: linterTags,
      include: linterInclude,
    },
    plugins: linterPlugins,
  }

  //  Imports be overriden

  newConfig.imports = {
    ...currentConfig.imports,
    ...config.imports,
  }

  //  Excludes be overriden

  const currentExclude = currentConfig.publish?.exclude || []
  const baseExclude = config.publish?.exclude || []
  const exclude = Array.from(new Set([...currentExclude, ...baseExclude]))

  newConfig.publish = { ...currentConfig.publish, exclude }

  // Test includes
  const testInclude = currentConfig.test?.include || []
  const baseTestInclude = config.test?.include || []
  newConfig.test = {
    ...currentConfig.test,
    include: Array.from(new Set([...testInclude, ...baseTestInclude])),
  }

  // TODO: set default tasks

  return newConfig
}
