import { join } from '@std/path'
import logger from '@zanix/utils/logger'

// Never worth walking into: `node_modules` can be huge (and its own `.ts` files aren't part of
// what was just generated), `.dist` is build output, `.git` is never source.
const SKIP_DIRS = new Set(['node_modules', '.dist', '.git'])

/** Every `.ts`/`.tsx` file under `root`, skipping `node_modules`/`.dist`/`.git`. Exported so
 * `scripts/drift-watch.ts` (§8.2) can reuse the exact same file-collection `verifyGeneratedProject`
 * (§8.3) already does, rather than a second, separately-maintained copy that could drift from it. */
export function collectTsFiles(root: string): string[] {
  const files: string[] = []
  const stack = [root]

  while (stack.length) {
    // deno-lint-ignore no-non-null-assertion
    const dir = stack.pop()!
    let entries: Deno.DirEntry[]
    try {
      entries = [...Deno.readDirSync(dir)]
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name))
        continue
      }
      if (
        entry.isFile &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      ) {
        files.push(join(dir, entry.name))
      }
    }
  }

  return files
}

/**
 * Runs `deno check` against every `.ts`/`.tsx` file under `root` — the `--verify` opt-in flag's
 * own mechanism (§8.3 of `ENGINEERING.md`'s Generator API Drift Strategy). A real compile check
 * against whatever dependency versions are actually resolvable right now, not just what `cli`
 * declared in `deno.json` — the same kind of check Drift Watch CI (§8.2) runs on a schedule, just
 * on-demand and scoped to this one generated/modified project instead of every variant.
 *
 * Never throws and never changes the calling command's exit code: a failure here means an
 * upstream Zanix package changed in a way `cli`'s own generated code doesn't account for (or
 * hasn't published yet — see `ENGINEERING.md` §7's `@zanix/app`/`@zanix/space` note), not that
 * generation itself failed. The files were still written correctly per `cli`'s own known API
 * shape; this is a warning about the world outside `cli`'s control, not an error in `cli` itself —
 * deliberately opt-in (not run by default) so `zanix new`/`zanix generate` stay 100% local and
 * instant unless a consumer explicitly asks for this extra, network-dependent check.
 */
export async function verifyGeneratedProject(root: string): Promise<void> {
  const files = collectTsFiles(root)
  if (files.length === 0) return

  const command = new Deno.Command(Deno.execPath(), {
    args: ['check', ...files],
    // Deno's config-file discovery (deno.json's own `compilerOptions`/`imports`) resolves from
    // this process's cwd, not from the checked files' own paths — without this, `deno check`
    // would silently pick up whatever `deno.json` happens to be above `cli`'s own cwd instead of
    // the generated project's, giving a false pass/fail against the wrong config entirely
    // (verified live: omitting this picked up `cli`'s own `deno.jsonc` and its `@zanix/types`
    // local-path override, masking a real `@zanix/app` "package not found" behind unrelated noise).
    cwd: root,
    stdout: 'null',
    stderr: 'piped',
  })

  const { success, stderr } = await command.output()

  if (success) {
    logger.info(
      'Verified: the generated project compiles cleanly against the currently installed dependency versions.',
    )
    return
  }

  logger.warn(
    'Verification failed: the generated project does not compile against the currently ' +
      'installed dependency versions. This usually means an upstream Zanix package published a ' +
      "breaking change, or hasn't published yet. The generated code is correct against cli's own " +
      `known API shape — real \`deno check\` output below:\n${new TextDecoder().decode(stderr)}`,
  )
}
