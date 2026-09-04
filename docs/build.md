# `zanix build` — compile and obfuscate

`zanix build` compiles your project's TypeScript with
[esbuild](https://esbuild.github.io/) for a fast, optimized production output —
optionally obfuscated and/or run off the main thread via a worker.

```bash
zanix build
```

| Option                      | Default                   | Description                                                                                        |
| --------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `-i, --input-file <path>`   | the project's root module | The source file to compile.                                                                        |
| `-o, --output-file <path>`  | the distribution file     | Where to write the compiled (and/or obfuscated) output.                                            |
| `-p, --platform <platform>` | `'neutral'`               | The esbuild target platform.                                                                       |
| `--external <names>`        | `'@*'`                    | Comma-separated libraries to exclude from the bundle. By default every `@*` JSR scope is excluded. |
| `--npm <names>`             | —                         | Comma-separated NPM libraries to exclude from the bundle.                                          |
| `--obfuscate`               | `false`                   | Obfuscate the output file.                                                                         |
| `-w, --use-worker`          | `false`                   | Run the build off the main thread. Only enable this when actually needed — it adds overhead.       |
| `--no-minify`               | (minifies)                | Skip minification.                                                                                 |
| `--no-bundle`               | (bundles)                 | Don't group everything into a single output file.                                                  |

## Examples

```bash
# Default build: bundled, minified, written to the distribution file
zanix build

# Obfuscated production build, excluding a specific npm dependency from the bundle
zanix build --obfuscate --npm some-native-addon

# Compile a specific entrypoint to a specific output path, unbundled
zanix build -i src/worker.ts -o .dist/worker.mjs --no-bundle
```

## See also

- [`new`](./new.md) — every project scaffold includes a `.dist/` folder this
  command writes into.
- [`generate`](./generate.md) — add artifacts to compile.
- [`prepare`](./prepare.md) — Git hooks, CI workflow, and editor configuration.
