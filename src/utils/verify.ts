import { join, resolve } from '@std/path'
import logger from '@zanix/utils/logger'

// Never worth walking into: `node_modules` can be huge (and its own `.ts` files aren't part of
// what was just generated), `.dist` is build output, `.git` is never source.
const SKIP_DIRS = new Set(['node_modules', '.dist', '.git'])

/** Every `.ts`/`.tsx` file under `root`, skipping `node_modules`/`.dist`/`.git`. Exported so
 * `scripts/drift-watch.ts` (§7.2) can reuse the exact same file-collection `verifyGeneratedProject`
 * (§7.3) already does, rather than a second, separately-maintained copy that could drift from it. */
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
 * Runs `deno fmt` against the whole generated project at `root` — unconditional, unlike
 * {@linkcode verifyGeneratedProject}'s own opt-in `--verify`: formatting is local, instant, and
 * needs no network access, so there's no cost worth gating behind a flag. Every generated
 * project's own `deno.json` already carries its real `fmt` config (`proseWrap`/`singleQuote`/
 * `lineWidth`/`semiColons`, written as part of the tree itself, not by `saveZanixConfig`) — this
 * reformats every file against THAT config, the same one a developer's own editor/pre-commit hook
 * would apply, so a hand-written template string that doesn't already match it byte-for-byte
 * (a real gap: a generated call with several nested options, like `getSpaceAppTemplate`'s own
 * `defineBootstrapSpaceAppConfig(...)`, can render as a single long, unformatted line) ships
 * correctly formatted regardless.
 *
 * Never throws: a real `deno fmt` failure here (a genuine bug in a template's own generated
 * syntax, not a formatting preference) would already have surfaced as a `deno check` failure via
 * `--verify`, or at the point Deno itself tries to parse the file — this call only ever fixes
 * STYLE, so a non-zero exit is logged and swallowed rather than failing the whole `zanix new`/
 * `zanix generate` run over what is, structurally, a cosmetic concern.
 *
 * @param root - The generated project's own root folder — same absolute/relative acceptance as
 * {@linkcode verifyGeneratedProject}.
 */
export async function formatGeneratedProject(root: string): Promise<void> {
  root = resolve(root)

  const command = new Deno.Command(Deno.execPath(), {
    args: ['fmt'],
    cwd: root,
    stdout: 'null',
    stderr: 'piped',
  })

  const { success, stderr } = await command.output()

  if (!success) {
    logger.warn(
      'Formatting the generated project failed — the generated files are otherwise correct; ' +
        `run \`deno fmt\` yourself to see the real error:\n${new TextDecoder().decode(stderr)}`,
    )
  }
}

/**
 * Runs `deno check` against every `.ts`/`.tsx` file under `root` — the `--verify` opt-in flag's
 * own mechanism (§7.3 of `engineering.md`'s Generator API Drift Strategy). A real compile check
 * against whatever dependency versions are actually resolvable right now, not just what `cli`
 * declared in `deno.json` — the same kind of check Drift Watch CI (§7.2) runs on a schedule, just
 * on-demand and scoped to this one generated/modified project instead of every variant.
 *
 * Never throws and never changes the calling command's exit code: a failure here means an
 * upstream Zanix package changed in a way `cli`'s own generated code doesn't account for, or
 * a dependency's currently-declared floor hasn't published yet, not that generation itself
 * failed. The files were still written correctly per `cli`'s own known API
 * shape; this is a warning about the world outside `cli`'s control, not an error in `cli` itself —
 * deliberately opt-in (not run by default) so `zanix new`/`zanix generate` stay 100% local and
 * instant unless a consumer explicitly asks for this extra, network-dependent check.
 *
 * @param root - The generated project's own root folder. Accepts either an absolute path or one
 * relative to the CALLING process's cwd (the common case — `zanix new <type> <name>` builds this
 * from a plain leaf `<name>`) — resolved to absolute internally before anything is collected or
 * spawned, so the caller never needs to resolve it first.
 */
export async function verifyGeneratedProject(root: string): Promise<void> {
  // Resolved to an absolute path up front (idempotent — a no-op if `root` was already absolute):
  // `collectTsFiles` builds every file path off `root` via `join`, and those SAME paths are later
  // passed as `args` to a `Deno.Command` spawned with `cwd: root`. If `root` were left relative
  // (the common case — `zanix new <type> <name>` with a plain leaf `name` builds `structure.FOLDER`
  // relative to the CALLING process's cwd), the child process would resolve those already-relative
  // args a SECOND time against its own `cwd` (which was just set to `root`), doubling the segment
  // (e.g. `'my-app/mod.ts'` becomes `'my-app/my-app/mod.ts'` inside the child) and failing every
  // file with a false "Cannot find module" — indistinguishable from a real compile error without
  // reading the raw path in stderr. Absolute paths have no such ambiguity for the child to
  // re-resolve.
  root = resolve(root)
  const files = collectTsFiles(root)
  if (files.length === 0) return

  const command = new Deno.Command(Deno.execPath(), {
    // `--min-dep-age 0` disables Deno's own "minimum dependency age" policy (a 24h default guard
    // against installing a just-published version) — without it, a generated project citing a
    // package's own just-published latest version (which its template always does) fails this
    // check with a false negative for ~24h after every release of that package, indistinguishable
    // from a real upstream breaking change without reading the raw stderr below.
    args: ['check', ...files, '--min-dep-age', '0'],
    // Deno's config-file discovery (deno.json's own `compilerOptions`/`imports`) resolves from
    // this process's cwd, not from the checked files' own paths — without this, `deno check`
    // silently picks up whatever `deno.json` happens to be above `cli`'s own cwd instead of
    // the generated project's, giving a false pass/fail against the wrong config entirely: `cli`'s
    // own `deno.jsonc` and its `@zanix/types` local-path override mask a real `@zanix/app`
    // "package not found" behind unrelated noise.
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
