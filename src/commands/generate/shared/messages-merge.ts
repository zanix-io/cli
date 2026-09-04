import { join } from '@std/path'

/**
 * Merges `newKeys` into an existing project's own `messages/{lang}/index.json`, once per entry in
 * `messageLangs` ({@linkcode getProjectMessageLangs}, `generate/shared/project.ts`) — adding a key
 * ONLY when it isn't already present, never overwriting a value the project's own catalog already
 * customized. Used by `errorTemplate`/`notFoundTemplate`'s own generator commands to seed the
 * catalog keys their generated `formatMessage(...)` calls read, so a project that already has
 * `messagesDir` configured gets a working translation out of the box, not a `formatMessage()` call
 * against a key that doesn't exist yet.
 *
 * Silently a no-op for a lang folder whose `index.json` doesn't exist yet or isn't valid JSON —
 * same graceful-degradation posture `space-population.ts`'s own catalog writer already has for a
 * missing/broken file: repairing an already-broken catalog is the project's own concern, not
 * something a generator should take on.
 */
export async function mergeMessageKeys(
  root: string,
  messageLangs: readonly string[],
  newKeys: (lang: string) => Record<string, string>,
): Promise<void> {
  await Promise.all(messageLangs.map(async (lang) => {
    const catalogPath = join(root, 'messages', lang, 'index.json')
    try {
      const catalog = JSON.parse(await Deno.readTextFile(catalogPath)) as Record<string, unknown>
      let changed = false
      for (const [key, value] of Object.entries(newKeys(lang))) {
        if (!(key in catalog)) {
          catalog[key] = value
          changed = true
        }
      }
      if (changed) {
        await Deno.writeTextFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
      }
    } catch {
      // No catalog for this lang, or malformed — left untouched, same as a missing `messages/`
      // directory altogether (`getProjectMessageLangs` already skips those before this runs).
    }
  }))
}
