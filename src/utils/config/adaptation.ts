import type { ConfigFile } from '@zanix/types'

/** Function to adapt current config to base config */
export const configAdaptation = (
  currentConfig: ConfigFile,
  config: ConfigFile,
) => {
  const newConfig = (Object.keys(currentConfig).length > 0) ? { ...currentConfig } : { ...config }

  newConfig.compilerOptions = {
    ...config.compilerOptions,
    ...currentConfig.compilerOptions,
  } as ConfigFile['compilerOptions']

  // `project` always takes the FRESH `config`'s value, never `currentConfig`'s — unlike every
  // other field merged below, this one deliberately isn't preserved from what was already there.
  // `config` reflects the project type just requested by the current `zanix new <type>`/`zanix
  // prepare` invocation, so re-running it in a directory whose config used to declare a DIFFERENT
  // `zanix.project` (e.g. re-scaffolding a `library` as a `server`) must update it to match, not
  // silently keep the stale value.
  newConfig.zanix = {
    ...config.zanix,
    ...currentConfig.zanix,
    project: config.zanix?.project,
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
  const linterTags = Array.from(
    new Set([...currentLinterTags, ...baseLinterTags]),
  )

  const currentIncludes = currentConfig.lint?.rules?.include || []
  const baseIncludes = lint.rules?.include || []
  const linterInclude = Array.from(
    new Set([...currentIncludes, ...baseIncludes]),
  )

  const currentPlugins = currentConfig.lint?.plugins || []
  const basePlugins = lint.plugins || []
  const linterPlugins = Array.from(
    new Set([...currentPlugins, ...basePlugins]),
  )

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

  // Tasks: an existing task under the same key always wins over the base default — unlike
  // `imports` (a version pin the CLI should keep authoritative), a task's shell command is
  // something a developer routinely hand-edits once scaffolded (extra permissions, a different
  // entry file), so regenerating the config on a later `zanix new`/`zanix prepare` run must never
  // clobber that customization. Base only fills in whatever key isn't already present.
  newConfig.tasks = { ...config.tasks, ...currentConfig.tasks }

  return newConfig
}
