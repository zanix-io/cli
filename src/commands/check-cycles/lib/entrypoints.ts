import { dirname, resolve } from '@std/path'
import { parse as parseJsonc } from '@std/jsonc'
import { exists } from '@std/fs'

/**
 * Real public entrypoints for a Zanix package, resolved from its own `deno.json(c)`'s `exports`
 * field to absolute file paths.
 *
 * A package's real activation side effect (an eager `registerXConnector()` call) commonly lives
 * behind a subpath entrypoint (`./core`) never reached by importing the package's main `.` export
 * alone — `@zanix/notifications`'s own `email/defs.ts` is the real, confirmed example: it's only
 * reachable through the `./core` export, invisible to a graph built from `.` alone. Every real
 * `exports` entry has to be seeded, not just the first one.
 */
export async function resolveRealEntrypoints(root: string): Promise<string[]> {
  const configPath = await findDenoConfig(root)
  if (!configPath) {
    throw new Error(`No 'deno.json'/'deno.jsonc' found under '${root}'.`)
  }

  const raw = await Deno.readTextFile(configPath)
  const config = parseJsonc(raw) as { exports?: Record<string, string> | string }
  const configDir = dirname(configPath)

  if (!config.exports) return []
  if (typeof config.exports === 'string') return [resolve(configDir, config.exports)]

  return Object.values(config.exports).map((relative) => resolve(configDir, relative))
}

async function findDenoConfig(root: string): Promise<string | undefined> {
  for (const name of ['deno.json', 'deno.jsonc']) {
    const candidate = resolve(root, name)
    // deno-lint-ignore no-await-in-loop
    if (await exists(candidate, { isFile: true })) return candidate
  }
  return undefined
}
