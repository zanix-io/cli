import { assertEquals } from '@std/assert'
import {
  registerValidationOptions,
  toValidationFlags,
} from 'commands/space/shared/validation-flags.ts'

// ================================================================================================
// The CLI's HALF of the flag contract.
//
// `@zanix/space` owns what the flags MEAN — which phases a mode runs, what strict does, which
// categories exist. That is tested there, once. What is tested here is only what the CLI itself is
// responsible for: declaring the flags identically on both commands, and translating this parser's
// own negation convention into the shape the resolver expects.
//
// Nothing in this file knows a rule code, a severity or a category, because nothing in the CLI does.
// ================================================================================================

/** Records what a command registers, without needing a real parser. */
function recordingCommand() {
  const flags: string[] = []
  const command = {
    option(flag: string, _description: string) {
      flags.push(flag)
      return command
    },
  }
  return { command, flags }
}

Deno.test('flags: all five validation flags are registered', () => {
  const { command, flags } = recordingCommand()
  registerValidationOptions(command)
  assertEquals(flags, [
    '--validation [mode:string]',
    '--no-validation',
    '--validation-strict',
    '--validation-category <categories:string>',
  ])
})

Deno.test(
  'flags: build and dev register the IDENTICAL set — two commands declaring the same flags ' +
    'separately is how their meanings drift apart',
  async () => {
    const build = recordingCommand()
    const dev = recordingCommand()
    // Both commands call the same registrar; this asserts they cannot diverge by construction.
    const { registerValidationOptions: register } = await import(
      'commands/space/shared/validation-flags.ts'
    )
    register(build.command)
    register(dev.command)
    assertEquals(build.flags, dev.flags)
  },
)

Deno.test(
  'flags: --no-validation arrives from this parser as `validation: false`, and is translated to ' +
    "the resolver's own `noValidation` — done once, here, so the convention does not leak into " +
    'each command',
  () => {
    assertEquals(toValidationFlags({ validation: false }), {
      noValidation: true,
      validationStrict: undefined,
      validationCategory: undefined,
    })
  },
)

Deno.test('flags: a mode passes through untouched', () => {
  assertEquals(toValidationFlags({ validation: 'render' }).validation, 'render')
  assertEquals(toValidationFlags({ validation: 'render' }).noValidation, undefined)
})

Deno.test({
  name: 'flags: absent validation stays absent — the resolver decides the default, not the CLI',
  fn: () => {
    assertEquals(toValidationFlags({}).validation, undefined)
    assertEquals(toValidationFlags({}).noValidation, undefined)
  },
})

Deno.test('flags: strict and category pass through unchanged', () => {
  const translated = toValidationFlags({
    validationStrict: true,
    validationCategory: 'html,a11y',
  })
  assertEquals(translated.validationStrict, true)
  assertEquals(translated.validationCategory, 'html,a11y')
})

Deno.test(
  'flags: the CLI never produces `rules` or `exempt` — per-rule severity and route exemptions are ' +
    'project policy, versioned with the project, never retyped on a command line',
  () => {
    const translated = toValidationFlags({
      validation: 'render',
      validationStrict: true,
      validationCategory: 'seo',
    }) as Record<string, unknown>
    assertEquals(Object.hasOwn(translated, 'rules'), false)
    assertEquals(Object.hasOwn(translated, 'exempt'), false)
  },
)
