import { assert, assertThrows } from '@std/assert'
import { getZanixPaths } from 'commands/new/lib/tree/tree.ts'

/**
 * `zanix new <type>` (implicit) must always resolve to exactly `--template base` (explicit) — the
 * whole point of formalizing `base` as a real, resolvable preset instead of an implicit default.
 * Verified here at the `getZanixPaths` level (pure, synchronous, no I/O) for every project type the
 * `new` command exposes, including `library`/`app`, which have no `ScaffoldRecipeRegistry` of their
 * own and rely entirely on `assertKnownPreset`'s upfront check in `getZnxFolderTree`.
 */
const PROJECT_TYPES = [
  'server',
  'space',
  'space-server',
  'library',
  'app',
] as const

interface FileDescriptor {
  relPath: string
  name: string
}

function collectFiles(
  // deno-lint-ignore no-explicit-any
  node: any,
  rootPrefix: string,
  acc: FileDescriptor[] = [],
): FileDescriptor[] {
  for (const file of node?.templates?.base ?? []) {
    acc.push({
      relPath: String(file.PATH).replace(rootPrefix, ''),
      name: file.NAME,
    })
  }
  for (const sub of Object.values(node?.subfolders ?? {})) {
    collectFiles(sub, rootPrefix, acc)
  }
  return acc
}

function sortedFiles(descriptors: FileDescriptor[]): string[] {
  return descriptors.map((d) => `${d.relPath}::${d.name}`).sort()
}

for (const type of PROJECT_TYPES) {
  Deno.test(
    `getZanixPaths('${type}') implicit === getZanixPaths('${type}', ..., 'base') explicit`,
    () => {
      const implicitRoot = `preset-equivalence-implicit-${type}`
      const explicitRoot = `preset-equivalence-explicit-${type}`

      const implicitTree = getZanixPaths(type, implicitRoot)
      const explicitTree = getZanixPaths(type, explicitRoot, 'base')

      const implicitFiles = sortedFiles(
        collectFiles(implicitTree, implicitRoot),
      )
      const explicitFiles = sortedFiles(
        collectFiles(explicitTree, explicitRoot),
      )

      assert(
        implicitFiles.length > 0,
        'the collected file list must not be empty',
      )
      assert(
        implicitFiles.length === explicitFiles.length &&
          implicitFiles.every((f, i) => f === explicitFiles[i]),
        `implicit and explicit 'base' trees must produce the same files for '${type}':\n` +
          `implicit: ${JSON.stringify(implicitFiles)}\nexplicit: ${JSON.stringify(explicitFiles)}`,
      )
    },
  )

  Deno.test(
    `getZanixPaths('${type}', ..., 'nonexistent') fails clearly before any tree is built`,
    () => {
      const error = assertThrows(
        () => getZanixPaths(type, `preset-unknown-${type}`, 'nonexistent'),
        Error,
        "Unknown template 'nonexistent'",
      )
      assert(
        error.message.includes('base'),
        'the error must list the known presets',
      )
    },
  )
}
