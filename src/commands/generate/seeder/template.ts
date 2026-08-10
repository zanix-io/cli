/**
 * Boilerplate for `zanix generate seeder <name>`.
 *
 * Embedded as string constants (not read from separate files) because `zanix build` bundles this
 * command's code into a single `.dist/app.mjs` output by default — a runtime file read relative
 * to `import.meta.url` would resolve against the bundle's location, not this file's original path.
 *
 * Content verified verbatim against real, production Zanix repositories' `seeders/` folders,
 * which are byte-identical across every sampled repository.
 */

/** `repositories/<name>/seeders/main.ts` */
export const SEEDER_MAIN = `import seedersProd from './seeders.prod.ts'
import seedersDev from './seeders.dev.ts'
import { defineSeeders } from 'utils/seeders.ts'

export default defineSeeders(seedersProd, seedersDev)
`

/** `repositories/<name>/seeders/seeders.dev.ts` */
export const SEEDER_DEV = `export default []
`

/** `repositories/<name>/seeders/seeders.prod.ts` */
export const SEEDER_PROD = `export default []
`

/** `src/utils/seeders.ts` — repo-scoped helper, written once, shared by every repository's seeders. */
export const SEEDERS_HELPER =
  `export const defineSeeders = <T>(seedersProd: T[], seedersDev: T[]) => {
  const seeders: typeof seedersProd = []
  seeders.push(...seedersProd)
  if (Deno.env.get('ENV') !== 'production') {
    seeders.push(...seedersDev)
  }
  return seeders
}
`
