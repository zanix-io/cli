/**
 * Boilerplate for `zanix generate repository <name>`.
 *
 * Embedded as string-template functions (not read from separate files) for the same reason as
 * `seeder/template.ts`: `zanix build` bundles this command's code into a single `.dist/app.mjs`
 * output by default, so a runtime file read relative to `import.meta.url` would resolve against
 * the bundle's location, not this file's original path.
 *
 * Content verified verbatim (class shell shape, constructor pattern) against real production
 * `entity.provider.ts` files — every one sampled follows the identical
 * `private Model; constructor() { super(); this.Model = this.database.getModel<Attrs>('name') }`
 * shape, differing only by name. `model.defs.ts` intentionally omits `extensions.seeders` — seed
 * data is a separate, optional artifact (`zanix generate seeder <name>`), not every repository has
 * one, and referencing a seeders file that doesn't exist yet would break the import.
 */

/** `repositories/<name>/entity.provider.ts` */
export const entityProviderTemplate = (
  pascalName: string,
  modelName: string,
): string =>
  `import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { ${pascalName}Attrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'

/**
 * Provider for ${pascalName} Repository Model Database.
 *
 * This class is responsible for managing ${pascalName} data.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider()
export class ${pascalName}Repository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<${pascalName}Attrs>('${modelName}')
  }

  /**
   * Method to find all ${modelName}
   */
  public findAll() {
    return this.Model.find().exec()
  }
}
`

/** `repositories/<name>/model.defs.ts` */
export const modelDefsTemplate = (
  pascalName: string,
  modelName: string,
): string =>
  `import { registerModel } from '@zanix/datamaster'

export type ${pascalName}Attrs = {
  id: string
  createdAt: Date
  updatedAt: Date
}

registerModel<${pascalName}Attrs>({
  name: '${modelName}',
  definition: {
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  options: {
    timestamps: true,
  },
})
`
