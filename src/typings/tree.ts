// deno-lint-ignore-file ban-types
import type { ZanixProjects } from '@zanix/types'

/**
 * Models the scaffold-tree shapes `zanix new`/`zanix generate` build and consume
 * (`commands/new/lib/tree/`) — `cli`'s own domain, moved here from `@zanix/utils/types` since `cli`
 * has always been the only real consumer of every type in this file (confirmed by a full grep
 * across every other package in the ecosystem, zero hits). `ZanixProjects` itself stays in
 * `@zanix/utils` — unlike these, it's genuinely shared vocabulary: part of
 * `ZanixGlobal['Znx']['config'].project`, the runtime global `@zanix/server` and consumer apps
 * read, not scaffold-tree modeling. See `@zanix/utils`'s own `docs/types.md`/`docs/helpers.md` for
 * the other side of this move.
 *
 * `ban-types` is ignored file-wide, matching the same ignore this file's content carried in
 * `@zanix/utils` before the move: the bare `{}` fallbacks below are deliberate — they mean "no
 * known keys, but don't constrain a later intersection," not "empty object." Swapping either for
 * the lint rule's own suggested `Record<PropertyKey, never>` looks equivalent but isn't: that
 * type carries an implicit `[x: string]: never` index signature, which breaks every later
 * intersection with a real, named-property subfolder shape (confirmed by a real `deno check`
 * regression while trying exactly that swap).
 */

/** `ZanixProjects` plus the `'all'` and `undefined` (common structure) cases. */
export type ZanixProjectsFull = ZanixProjects | 'all' | undefined

/** Zanix Templates for Automated File Generation */
export type ZanixTemplates = 'base'

/** Context passed to a template's `content` resolver function. */
export type ZanixLocalContentProps = { metaUrl: string; relativePath?: string }

/** A record of generated template files, grouped by template category. */
export type ZanixTemplatesRecord = Record<
  ZanixTemplates,
  {
    PATH: string
    NAME: string
    content(local: ZanixLocalContentProps): Promise<string>
  }[]
>

/** The base fields present on every Zanix folder-tree node. */
export type ZanixBaseFolderProps<S> = {
  readonly FOLDER: string
  readonly NAME: string
  templates: ZanixTemplatesRecord
  subfolders: S
}

/** The recursive folder-tree shape shared by all Zanix folder structures. */
export type ZanixBaseFolder<
  S extends Record<string, Partial<ZanixBaseFolder>> | undefined = undefined,
  O extends 'noTemplates' | undefined = undefined,
> = Omit<
  ZanixBaseFolderProps<S>,
  O extends 'noTemplates' ? S extends undefined ? 'subfolders' | 'templates'
    : 'templates'
    : S extends undefined ? 'subfolders'
    : never
>

/**
 * Represents a generic folder structure used to model a file system where each folder
 * can contain other subfolders (recursively) and files
 */
export type ZanixFolderGenericTree = Partial<
  ZanixBaseFolder<
    Record<string, Partial<ZanixBaseFolder>>
  >
>

/** Zanix Server Folder structure */
export type ZanixServerSrcTree = ZanixBaseFolder<{
  connectors: ZanixBaseFolder
  handlers: ZanixBaseFolder<{ rtos: ZanixBaseFolder }>
  interactors: ZanixBaseFolder
  jobs: ZanixBaseFolder
  repositories: ZanixBaseFolder<{ seeders: ZanixBaseFolder }>
}, 'noTemplates'>

/** Zanix Library Folder structure */
export type ZanixLibrarySrcTree = ZanixBaseFolder<undefined>

/**
 * Zanix Space Folder structure — a `@zanix/space` frontend app's real, implemented conventions:
 * file-based page routing rooted at `routes/` (`page.tsx`/`layout.tsx`/`loading.tsx`/`error.tsx`,
 * nested per segment) and `comets/` for selective-hydration client components.
 * @experimental
 */
export type ZanixSpaceSrcTree = ZanixBaseFolder<{
  routes: ZanixBaseFolder
  comets: ZanixBaseFolder
}, 'noTemplates'>

/** Maps each Zanix project type to its `src` subfolder shape. */
export type ZanixSrcTreeMap = {
  server: { server: ZanixServerSrcTree }
  space: { space: ZanixSpaceSrcTree }
  library: { modules: ZanixLibrarySrcTree }
  'space-server': { space: ZanixSpaceSrcTree; server: ZanixServerSrcTree }
  all: {
    modules: ZanixLibrarySrcTree
    space: ZanixSpaceSrcTree
    server: ZanixServerSrcTree
  }
}

/** Resolves the `src` subfolder shape for a given Zanix project type. */
export type ZanixSrcTree<T extends ZanixProjectsFull> = T extends keyof ZanixSrcTreeMap
  ? ZanixSrcTreeMap[T]
  : {}

/** Zanix general folders */
export type ZanixFolderTree<T extends ZanixProjectsFull = undefined> = ZanixBaseFolder<
  {
    '.dist': ZanixBaseFolder<undefined, 'noTemplates'>
    docs: ZanixBaseFolder
    src: ZanixBaseFolder<
      ZanixSrcTree<T> & {
        '@tests': ZanixBaseFolder<{
          functional: ZanixBaseFolder
          integration: ZanixBaseFolder
          unit: ZanixBaseFolder
        }, 'noTemplates'>
        shared: ZanixBaseFolder<
          T extends 'library' | undefined ? {}
            : { middlewares: ZanixBaseFolder },
          'noTemplates'
        >
        typings: ZanixBaseFolder
        utils: ZanixBaseFolder
      },
      'noTemplates'
    >
  }
>
