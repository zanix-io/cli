import type { ZanixFolderTree, ZanixProjectsFull } from '@zanix/types'

import { ZanixTree } from 'commands/new/lib/tree/base-tree.ts'
import { assertKnownPreset } from 'commands/new/lib/tree/presets.ts'
import { getCommonTree } from 'commands/new/lib/tree/projects/commons.ts'
import {
  getServerModTemplate,
  getServerSrcTree,
  getWorkerModTemplate,
  WORKER_MODULE,
} from 'commands/new/lib/tree/projects/server.ts'
import { getLibrarySrcTree } from 'commands/new/lib/tree/projects/library.ts'
import {
  getSpaceAppTemplate,
  getSpaceModTemplate,
  getSpaceSrcTree,
  SPACE_APP_MODULE,
} from 'commands/new/lib/tree/projects/space.ts'
import { assembleAppScaffold } from 'commands/new/lib/tree/projects/app.ts'
import { MAIN_MODULE } from '@zanix/utils/constants'
import { getFolderName } from '@zanix/helpers'
import { join } from '@std/path'

const jsr = '@zanix/core'

/**
 * Zanix folders function structure for all projects.
 *
 * @param preset - `zanix new <type> --template <preset>`'s own value (default `'base'` — the same
 * default the CLI option itself carries, kept in sync deliberately, not by coincidence: `zanix new
 * <type>` and `zanix new <type> --template base` must always resolve identically). Validated here,
 * first, before any tree gets built for *any* type — the one check that runs regardless of which
 * type-specific validation follows: `resolveRecipe` for `server`/`space`/`app` (each has its own
 * `ScaffoldRecipeRegistry`), `assertKnownPreset` again, directly, for `library` (see its own doc for
 * why it has no registry of its own to resolve against).
 */
export const getZnxFolderTree = <
  T extends ZanixProjectsFull,
>(root: string, type?: T, preset: string = 'base'): ZanixFolderTree<T> => {
  assertKnownPreset(preset)

  let ZNX_STRUCT
  const commonTree = getCommonTree(root, type)

  if (!type) return commonTree as ZanixFolderTree<T>
  else ZNX_STRUCT = commonTree as unknown as ZanixFolderTree<'all'>

  const isAll = type === 'all'

  if (type === 'library' || isAll) {
    ZNX_STRUCT.subfolders.src.subfolders.modules = getLibrarySrcTree(root, preset)
  }

  if (type !== 'library' || isAll) {
    ZNX_STRUCT.subfolders.src.subfolders.shared = ZanixTree.create(
      join(root, 'src/shared'),
      {
        subfolders: {
          middlewares: {
            templates: {
              base: { files: ['pipe.defs.ts', 'interceptor.defs.ts'], jsr },
            },
          },
        },
      },
    )

    if (type === 'space' || type === 'space-server' || isAll) {
      ZNX_STRUCT.subfolders.src.subfolders.space = getSpaceSrcTree(root, preset)
    }

    if (type === 'server' || type === 'space-server' || isAll) {
      ZNX_STRUCT.subfolders.src.subfolders.server = getServerSrcTree(root, preset)
    }
  }

  // `app` (a `defineZanixApp()`-based package) needs no dedicated `src/app` subfolder of its own
  // — unlike `space`/`server`, its ONLY real artifact is the manifest itself, which lives at the
  // package root (`mod.ts`, the actual entry point a consumer imports), not under `src/`.
  // `assembleAppScaffold` resolves `app`'s own recipe (its own `resolveRecipe` check, same as
  // `server`/`space` get) and appends its `mod.ts` entry onto the already-built common
  // `templates.base` array — never a replace, see `assembleScaffold`'s own doc for why that matters
  // for this exact node.
  if (type === 'app' || isAll) {
    assembleAppScaffold(ZNX_STRUCT as unknown as ZanixFolderTree<'app'>, preset)
  }

  // `server`/`space-server` need a real, runnable root entrypoint too — same reasoning as `app`
  // above, just via `@zanix/core`'s `Zanix.start()` instead of `defineZanixApp()`. Deliberately
  // excludes `isAll` (unlike the `app` push above): `isAll` is only ever used by tree-shape tests
  // that assert subfolder existence, never by a real `createFilesAndFolders` write — combining it
  // here would push a second `templates.base` entry at the same `root/mod.ts` path as `app`'s own.
  if (type === 'server' || type === 'space-server') {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, MAIN_MODULE),
      NAME: MAIN_MODULE,
      content: () =>
        Promise.resolve(
          getServerModTemplate(getFolderName(root), type === 'space-server'),
        ),
    })

    // A separate entrypoint/process from `mod.ts` above — see `getWorkerModTemplate`'s own doc.
    // Excludes plain `space`: it has no `@zanix/core`/`@zanix/asyncmq` dependency at all.
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, WORKER_MODULE),
      NAME: WORKER_MODULE,
      content: () => Promise.resolve(getWorkerModTemplate(getFolderName(root))),
    })
  }

  // Plain `space` (pure frontend, no backend) needs its own real entrypoint too — direct
  // `activateApps()`/`bootstrapServers()` composition, never `@zanix/core` (see
  // `getSpaceModTemplate`'s own doc for why). Previously missing entirely: `znx new space`
  // scaffolded `page.tsx`/`example.comet.tsx` with nothing that would ever load them.
  if (type === 'space') {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, MAIN_MODULE),
      NAME: MAIN_MODULE,
      content: () => Promise.resolve(getSpaceModTemplate()),
    })
  }

  // `space`/`space-server` both need `space.app.ts` — the manifest alone, split out of `mod.ts` (see
  // `getSpaceAppTemplate`'s own doc). `zanix space dev` imports this file directly; `mod.ts` (pushed
  // above, either branch) imports its default export rather than declaring the manifest inline.
  if (type === 'space' || type === 'space-server') {
    ZNX_STRUCT.templates.base.push({
      PATH: join(root, SPACE_APP_MODULE),
      NAME: SPACE_APP_MODULE,
      content: () => Promise.resolve(getSpaceAppTemplate(getFolderName(root))),
    })
  }

  return ZNX_STRUCT as ZanixFolderTree<T>
}
