import { generatorRegistry } from 'commands/generate/registry.ts'
import { Commander } from 'cli'

/** 'generate' command */
export default function generateCommand(this: Commander) {
  const cwd = new Commander()
  this.command('generate', cwd)
    .alias('g')
    .description('Generate individual artifacts into an existing Zanix project.')
    .action(() => {
      cwd.throw(new Error("You must provide an artifact to generate for the 'generate' command."))
    })

  for (const register of generatorRegistry) register(cwd)
}
