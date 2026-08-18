/**
 * The validation flags, registered identically on `zanix space build` and `zanix space dev`.
 *
 * Registered from one place on purpose. Two commands declaring the same flags separately is how
 * their help text, their defaults and eventually their meanings drift apart — and a validator whose
 * `--validation-strict` means something different depending on which command you ran is not one
 * anybody can trust.
 *
 * **This module registers and adapts; it decides nothing.** Every semantic — which phases a mode
 * runs, what strict does, whether a category is valid — lives in `@zanix/space`'s own
 * `resolveValidationFlags`. Nothing here knows a rule code, a severity or a category.
 *
 * @module
 */

/** The flags as this CLI's parser hands them over. */
export type SpaceValidationOptions = {
  /**
   * `--validation` / `--validation=<mode>`, and ALSO `--no-validation`.
   *
   * One field for both because that is the parser's own convention for a negatable option: it sets
   * this to `false` for `--no-validation`, rather than exposing a separate flag. See
   * {@linkcode toValidationFlags}, which is where that convention is translated — once, explicitly,
   * instead of leaking into each command.
   */
  validation?: boolean | string
  validationStrict?: boolean
  validationCategory?: string
}

/** The shape `@zanix/space`'s own `resolveValidationFlags` expects. */
export type SpaceValidationFlags = {
  validation?: boolean | string
  noValidation?: boolean
  validationStrict?: boolean
  validationCategory?: string
}

/**
 * Translates this CLI's parser conventions into the shape `@zanix/space`'s flag resolver expects.
 *
 * The only thing it actually converts is negation: `--no-validation` arrives as `validation: false`,
 * and the resolver models "off" as its own `noValidation` field so that turning validation off is
 * never confusable with passing it a mode. Doing that translation here, once, keeps the CLI's
 * parser convention out of the framework and the framework's model out of each command.
 */
export function toValidationFlags(options: SpaceValidationOptions): SpaceValidationFlags {
  const { validation, validationStrict, validationCategory } = options
  return {
    ...(validation === false ? { noValidation: true } : { validation }),
    validationStrict,
    validationCategory,
  }
}

/**
 * The one method this module needs from a command being built. Typed structurally rather than by
 * importing a command type: this CLI's own barrel does not export one, and depending on the parser
 * library's type here would couple flag registration to that library for no benefit.
 */
export type OptionRegistrar = {
  option: (flags: string, description: string) => OptionRegistrar
}

/**
 * Adds the validation flags to a command.
 *
 * @param command - The command being built. Mutated in place rather than returned: the parser's own
 * chaining returns a differently-typed value at each step, and threading that through a generic
 * would buy nothing here — every caller registers these flags and then keeps using its own command
 * object.
 */
export function registerValidationOptions(command: OptionRegistrar): void {
  command
    .option(
      '--validation [mode:string]',
      "Document validation to run: 'static' (the default) or 'render', which ADDS a render probe " +
        'on top of the static phase rather than replacing it.',
    )
    .option(
      '--no-validation',
      'Skip document validation entirely.',
    )
    .option(
      '--validation-strict',
      'Treat every active warning as an error. Does not promote info-level findings, and does not ' +
        'switch on rules a project has not enabled.',
    )
    .option(
      '--validation-category <categories:string>',
      'Restrict validation to these categories, comma-separated: html, seo, a11y, social, pwa, ' +
        'framework. An unknown category is an error rather than a silent no-op.',
    )
}
