import type { ConfigFile } from '@zanix/types'
import { assertEquals } from '@std/assert'
import { configAdaptation } from 'utils/config/adaptation.ts'

Deno.test('configAdaptation should default fmt, lint, publish and test when omitted', () => {
  const currentConfig: ConfigFile = {}
  const config: ConfigFile = {
    name: '@project/name',
    compilerOptions: { strict: true, noImplicitAny: true },
  }

  const result = configAdaptation(currentConfig, config)

  assertEquals(result.fmt, {
    indentWidth: undefined,
    lineWidth: undefined,
    singleQuote: undefined,
    semiColons: undefined,
  })
  assertEquals(result.lint?.rules?.tags, [])
  assertEquals(result.lint?.rules?.include, [])
  assertEquals(result.lint?.plugins, [])
  assertEquals(result.publish?.exclude, [])
  assertEquals(result.test?.include, [])
})

Deno.test('configAdaptation should merge fmt, lint, publish and test when provided', () => {
  const currentConfig: ConfigFile = {
    test: { include: ['src/@tests/current/**/*.test.ts'] },
  }
  const config: ConfigFile = {
    name: '@project/name',
    compilerOptions: { strict: true, noImplicitAny: true },
    fmt: {
      indentWidth: 2,
      lineWidth: 100,
      singleQuote: true,
      semiColons: false,
    },
    lint: {
      rules: { tags: ['recommended'], include: ['eqeqeq'] },
      plugins: ['jsr:@zanix/utils/linter/deno-zanix-plugin'],
    },
    publish: { exclude: ['.github'] },
    test: { include: ['src/@tests/**/*.test.ts'] },
  }

  const result = configAdaptation(currentConfig, config)

  assertEquals(result.fmt?.indentWidth, 2)
  assertEquals(result.lint?.rules?.tags, ['recommended'])
  assertEquals(result.lint?.rules?.include, ['eqeqeq'])
  assertEquals(result.lint?.plugins, [
    'jsr:@zanix/utils/linter/deno-zanix-plugin',
  ])
  assertEquals(result.publish?.exclude, ['.github'])
  assertEquals(
    result.test?.include?.sort(),
    [
      'src/@tests/**/*.test.ts',
      'src/@tests/current/**/*.test.ts',
    ].sort(),
  )
})

Deno.test('configAdaptation fills in a missing task from the base config', () => {
  const currentConfig: ConfigFile = {}
  const config: ConfigFile = {
    name: '@project/name',
    tasks: { dev: 'deno run --watch mod.ts' },
  }

  const result = configAdaptation(currentConfig, config)

  assertEquals(result.tasks, { dev: 'deno run --watch mod.ts' })
})

Deno.test('configAdaptation never overwrites a task the project already customized', () => {
  const currentConfig: ConfigFile = {
    tasks: { dev: 'deno run --watch --allow-net mod.ts', test: 'deno test' },
  }
  const config: ConfigFile = {
    name: '@project/name',
    tasks: { dev: 'deno run --watch mod.ts', start: 'deno run mod.ts' },
  }

  const result = configAdaptation(currentConfig, config)

  assertEquals(result.tasks, {
    // `dev` keeps the project's own customized command, not the base default.
    dev: 'deno run --watch --allow-net mod.ts',
    // `start` is filled in from the base since the project never defined one.
    start: 'deno run mod.ts',
    // A task the base doesn't even know about is preserved untouched.
    test: 'deno test',
  })
})
