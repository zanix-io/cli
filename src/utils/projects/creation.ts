import type { ZanixFolderGenericTree } from 'typings/tree.ts'

import { fileExists, folderExists } from '@zanix/helpers'
import { dirname } from '@std/path'

/**
 * Ensures `constantName` is declared in `filePath`, appending `declaration` if it's missing —
 * creates the file (and its folder) from scratch when it doesn't exist yet at all. Unlike
 * `createFilesAndFolders`'s whole-file "never overwrite" guard, this targets a single constant
 * inside a file that may already have unrelated content (e.g. a project's own
 * `src/utils/constants.ts`), so a generator needing one doesn't clobber whatever's already there.
 * No current `zanix generate`/`zanix new` output actually calls this — `rto`'s own `IsPermission`
 * (the last real caller, via `PERMISSION_REGEX`) has no ecosystem-wide "permission format" to
 * validate against (real production values span hierarchical strings like `zanix:admin:triggers`
 * and flat ones like `'admin'`, neither matching a fixed regex), so `permission` now renders as a
 * plain `IsString` field with no dedicated constant of its own — kept as a general-purpose utility
 * (still directly unit-tested below) for the next generator that genuinely needs a project-owned
 * constant, not dead code tied to `rto` specifically.
 *
 * A plain substring check for `constantName` — conservative on purpose: it may skip appending in
 * an unlikely false-positive (the name appearing in a comment), but it will never duplicate the
 * declaration, which is the failure mode that actually matters here.
 */
export async function ensureConstant(
  filePath: string,
  constantName: string,
  declaration: string,
): Promise<void> {
  if (!fileExists(filePath)) {
    await Deno.mkdir(dirname(filePath), { recursive: true })
    await Deno.writeTextFile(filePath, `${declaration}\n`)
    return
  }

  const content = await Deno.readTextFile(filePath)
  if (content.includes(constantName)) return

  const separator = content.endsWith('\n') ? '' : '\n'
  await Deno.writeTextFile(filePath, `${content}${separator}${declaration}\n`)
}

/**
 * Fills in the one placeholder inside `@zanix/utils`'s shared `LICENSE` template that `zanix new`
 * actually CAN know for real: `[YEAR]`, the current calendar year — not project-specific, just
 * today's date, so there's no reason to ever leave it unfilled the way an unedited copy did in
 * `@zanix/admin`'s own generated `LICENSE` (fixed there by hand; this is the generator-side fix so
 * it can't recur).
 *
 * `[ORGANIZATION]` is deliberately left untouched, for the exact same reason `baseZnxConfig`
 * leaves `@your-scope` fake (see its own doc): `zanix new` can never know a user's real copyright
 * holder — not their project name, not a JSR scope, not a GitHub org slug (this ecosystem's own
 * real LICENSE files say `ZANIX`, a distinct thing from the GitHub org `zanix-io` — a future
 * change must never try to derive one from the other). Leaving it as an unmistakable placeholder
 * that still needs a human is correct; guessing at it would be worse than leaving it blank.
 *
 * Scoped to `LICENSE` specifically (`fileName === 'LICENSE'`), not a generic templating pass over
 * every fetched file — every other file `zanix new` fetches from `@zanix/utils`'s
 * `src/templates/` (`README.md`, `CHANGELOG.md`, `see-more.md`, the `example.*` starters) is
 * copied byte-for-byte today with no placeholder of its own to fill; building a general
 * substitution pipeline for that would be speculative infrastructure for a need that doesn't
 * exist yet.
 */
export function fillLicenseYear(fileName: string, content: string): string {
  if (fileName !== 'LICENSE') return content
  return content.replace('[YEAR]', String(new Date().getFullYear()))
}

/**
 * Recursively materializes a `ZanixFolderGenericTree` node (and every one of its `subfolders`,
 * depth-first) onto disk — creating folders as needed and writing each `template`-selected file's
 * content. Whole-file "never overwrite" guard: a file whose `PATH` already exists on disk is
 * silently skipped (`fileExists(filePath)` check below), never regenerated — this is what makes
 * every `zanix generate`/`zanix new` command safe to re-run without clobbering hand-edited
 * content. Contrast with `ensureConstant` above, which targets a single constant inside a file
 * that may already have unrelated content, rather than an entire file. Runs every fetched file's
 * content through `fillLicenseYear` right before writing — a no-op for anything other than
 * `LICENSE`, see that function's own doc for why this is the one deliberate exception.
 */
export async function createFilesAndFolders(
  obj: ZanixFolderGenericTree,
  template: 'base',
): Promise<void> {
  // Create folder if it does not exist and if has files or subfolders inside
  const existFolder = obj.FOLDER && !folderExists(obj.FOLDER)
  const selectedTemplate = obj.templates?.[template]
  const hasContent = selectedTemplate || obj.subfolders
  if (existFolder && hasContent) {
    // deno-lint-ignore no-non-null-assertion
    await Deno.mkdir(obj.FOLDER!, { recursive: true })
  }

  const pending: Promise<unknown>[] = []

  if (selectedTemplate) {
    const folderPaths = new Set<string>()
    for (const file of selectedTemplate) {
      if (file.PATH) folderPaths.add(dirname(file.PATH))
    }
    await Promise.all(
      [...folderPaths].map((folderPath) => Deno.mkdir(folderPath, { recursive: true })),
    )

    for (const file of selectedTemplate) {
      const filePath = file.PATH
      if (!filePath) continue

      // Create example file
      if (!fileExists(filePath)) {
        pending.push(
          file.content({ metaUrl: import.meta.url }).then(
            (text) => Deno.writeTextFile(filePath, fillLicenseYear(file.NAME, text)),
          ),
        )
      }
    }
  }

  // Subfolders recoursivity
  if (obj.subfolders) {
    for (const folderName in obj.subfolders) {
      const subfolder = obj.subfolders[folderName]
      pending.push(createFilesAndFolders(subfolder, template))
    }
  }

  await Promise.all(pending)
}
