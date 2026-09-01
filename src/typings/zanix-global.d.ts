import type { ZanixGlobal } from '@zanix/types'

/**
 * Declares the `Znx` runtime global (and its `Window` augmentation) that `@zanix/server`'s own
 * reachable source (`utils/constants.ts`, `modules/infra/middlewares/defaults/cookies.guard.ts`)
 * reads from — see `ZanixGlobal`'s own doc (`@zanix/utils`'s `typings/zanix.ts`) for why a consumer
 * declares this block itself instead of receiving it automatically: JSR does not support a package
 * injecting global namespace declarations into consumers.
 *
 * Kept as this package's own local declaration, referencing `ZanixGlobal` through the real
 * published `@zanix/types` specifier, rather than pointing `compilerOptions.types` at
 * `@zanix/utils`'s own source file directly — the latter would resolve `ZanixGlobal`'s own `Logger`
 * type reference against whichever `@zanix/utils` checkout physically owns that file, a second,
 * separate module instance from the `jsr:@zanix/utils@^4.1.0/logger` one every other file in this
 * package resolves `@zanix/logger` to whenever a dependency's source physically lives under an
 * unpublished local checkout instead of the real registry copy — this file avoids that entirely by
 * only ever reaching `ZanixGlobal` through the real published package. Same fixed pattern as
 * `@zanix/datamaster`'s own `src/typings/zanix-global.d.ts`.
 */
declare global {
  const Znx: ZanixGlobal['Znx']
  interface Window extends ZanixGlobal {}
}
