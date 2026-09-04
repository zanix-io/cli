import { resolve } from '@std/path'
import { exists } from '@std/fs'

/** The one field of `deno.lock` this command actually reads — a map from every specifier Deno
 * resolved (`jsr:@zanix/auth@^1.0.0`, `jsr:@zanix/auth@~0.8.1`, ...) to the concrete version it
 * resolved to (`1.0.0`, `0.8.1`, ...). `deno.lock` is plain JSON (unlike `deno.json(c)`, which
 * allows comments), so no `@std/jsonc` parsing is needed here. */
interface DenoLock {
  specifiers?: Record<string, string>
}

/**
 * Reads `<root>/deno.lock` and returns its `specifiers` map — every specifier Deno resolved in
 * this project, mapped to the concrete version it resolved to.
 *
 * @param {string} root - The project root expected to contain a `deno.lock` (normally the same
 * directory as its `deno.json(c)`).
 * @returns {Promise<Record<string, string>>} The lockfile's `specifiers` map, or `{}` if the
 * lockfile has none.
 * @throws {Error} If no `deno.lock` exists under `root` — this command needs a real, already
 * resolved lockfile to inspect; it never resolves dependencies itself.
 */
export async function readLockfileSpecifiers(root: string): Promise<Record<string, string>> {
  const path = resolve(root, 'deno.lock')

  if (!(await exists(path, { isFile: true }))) {
    throw new Error(
      `No 'deno.lock' found under '${root}'. Run 'deno install' (or 'deno cache') first so ` +
        'there is a real resolved lockfile to check.',
    )
  }

  const raw = await Deno.readTextFile(path)
  const lock = JSON.parse(raw) as DenoLock

  return lock.specifiers ?? {}
}
