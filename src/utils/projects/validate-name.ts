/**
 * Rejects a project name/path that contains a `..` traversal segment — `zanix new <type> <name>`
 * accepts `name` as a plain leaf directory name in the common case, but every action's own test
 * suite (and `--prepare`'s own forwarding) also legitimately passes a full absolute/nested path
 * (e.g. pointing generation at an isolated temp directory), so this deliberately does NOT reject
 * `/`/`\` or an absolute path outright — only a `..` segment, which is never a legitimate part of
 * either use case and is the actual escape vector: without this, a name like
 * `'../../etc/cron.d/evil'` (plausible from an automated/scripted caller of this CLI — a wrapper
 * tool, a web-based generator UI — not only a human typing it interactively) would let
 * `getZanixPaths` write the new project's files outside the intended directory, up to the
 * filesystem root.
 *
 * By default an empty `name` is also rejected — the common `zanix new <type> <name>` case, where
 * an empty name is never meaningful. Pass `{ allowEmpty: true }` for the one legitimate exception:
 * `commands/generate/shared/safe-name.ts`'s `assertSafeGeneratorRoutePath`, where the four
 * `<route-path>`-taking generators (`page`/`layout`/`error`/`loading`) treat `''` as the app's real
 * root route/root layout, not a missing value — the `..`-segment check still applies unconditionally
 * either way.
 *
 * @param name The project name or path to validate.
 * @param options.allowEmpty When `true`, an empty `name` is accepted instead of rejected. Defaults
 * to `false`.
 * @throws {Error} if (`name` is empty and `allowEmpty` is not `true`), or any of its
 * `/`/`\`-separated segments is exactly `..`.
 */
export function assertSafeProjectName(name: string, options?: { allowEmpty?: boolean }): void {
  const allowEmpty = options?.allowEmpty ?? false
  const hasTraversalSegment = name.split(/[\\/]/).some((segment) => segment === '..')
  if ((!allowEmpty && !name) || hasTraversalSegment) {
    throw new Error(
      `Invalid project name "${name}" — it can't contain a ".." path-traversal segment.`,
    )
  }
}
