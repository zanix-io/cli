import type { OnResolveArgs, Plugin } from 'npm:esbuild@0.20.2'

/**
 * esbuild plugin to ignore resolution errors for npm modules.
 *
 * This plugin intercepts the module resolution process and marks npm modules
 * (like `esbuild` and `javascript-obfuscator`) as external, meaning they will not
 * be bundled and their resolution will be ignored during the build process.
 * This helps to avoid errors related to modules that cannot be resolved or are
 * not required to be included in the final bundle.
 *
 * @returns {Plugin} esbuild plugin to ignore resolution errors for specific modules.
 */
export function npmModulesPlugin(libraries: string[]): Plugin {
  const externals = [...defaultNpmModules, ...libraries]
  return {
    name: 'npm-modules',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        // Ignore resolution for specific problematic modules
        if (externals.includes(args.path)) {
          return { external: true, path: `npm:${args.path}` } // Send as external npm
        }
        return null
      })
    },
  }
}

export const defaultNpmModules = ['esbuild', 'javascript-obfuscator']
