import type { FormatAvailableFiles, LinterAvailableFiles, ZanixProjects } from '@zanix/types'

/**
 * Option types for `zanix prepare`'s git/editor scaffolding. Moved here from `@zanix/utils` —
 * verified their only real consumer ecosystem-wide is `cli` itself.
 */

/** Base options shared by the GitHub helpers that create files or hooks. */
export type BaseGithubHelperOptions = {
  /** The folder where the file/hook should be created. Defaults vary per helper. */
  baseFolder?: string
  /** The current directory */
  baseRoot?: string
}
/** Options accepted by {@link createHook}. */
export type HookOptions = BaseGithubHelperOptions & {
  /**  A flag indicating whether a symbolic link should be created in the GitHub hooks directory. */
  createLink?: boolean
}

/** Options accepted by {@link createPreCommitHook}. */
export type PreCommitHookOptions = HookOptions & {
  /**
   * The filePatterns property is an optional configuration object that defines the file patterns for linting and formatting operations.
   */
  filePatterns?: {
    /** This parameter specifies the types of files that should be checked by the linter.  */
    lint?: LinterAvailableFiles[]
    /** This parameter defines which file types should be automatically formatted. */
    fmt?: FormatAvailableFiles[]
  }
}

/** The workflow types */
export type WorkFlowTypes = 'publish' | null

/** Options accepted by {@link createGitWorkflow}. */
export type WorkflowOptions = BaseGithubHelperOptions & {
  /**
   * The Zanix project type the workflow should be generated for. Defaults to `'library'`.
   */
  projectType?: ZanixProjects
  /**
   * The main branch where the version should be published using the workflow.
   * This specifies the primary branch for version deployment.
   * Defaults to `master`
   */
  mainBranch?: string
}

/** Options accepted by {@link prepareGithub}. */
export type PrepareGithubOptions = {
  /**
   * legacyHooks options to create main github hooks without using the framework
   *    - `preCommitHook`
   *    - `pushHook`
   */
  legacyHooks?: {
    /**
     * createPreCommitHook options
     *   - `baseFolder`: The folder where the hook should be created.
     *   - `createLink`: A flag indicating whether a symbolic link should be created in the GitHub hooks directory.
     *   - `filePatterns` - The filePatterns property is an optional configuration object that defines the file patterns for linting and formatting operations.
     */
    preCommit?: PreCommitHookOptions
    /**
     * createPrePushHook options
     *   - `baseFolder`: The folder where the hook should be created.
     *   - `createLink`: A flag indicating whether a symbolic link should be created in the GitHub hooks directory.
     */
    prePush?: HookOptions
  }
  /**
   * usePrecommit option to use pre-commit framework
   */
  usePrecommit?: true | Omit<BaseGithubHelperOptions, 'baseFolder'>
  /**
   * createGitWorkflow options
   *   - `baseFolder`: The directory where the workflow file should be created.
   *   - `mainBranch`: The main branch that will trigger the workflow when publishing a new version.
   *   - `projectType`: Optional ZanixProject type to define correct workflow. Defaults to `library`
   */
  publishWorkflow?: WorkflowOptions
  /**
   * createIgnoreBaseFile options
   *   - `baseFolder`: The folder where the `.gitignore` should be created. Defaults to `root`
   */
  gitIgnoreBase?: Omit<BaseGithubHelperOptions, 'baseFolder'>
}

/** The Editors type is a union type that defines a set of supported text editors. */
export type Editors = 'vscode'

/** Base options shared by the editor config helpers. */
export type BaseEditorHelperOptions = {
  /** The current directory */
  baseRoot?: string
}

/** The editor helper options */
export type EditorOptions = { type: Editors }

/**
 * Base options shared by the Docker helpers that create files. No `baseFolder` (unlike
 * {@link BaseGithubHelperOptions}) — a `Dockerfile`/`.dockerignore` always lives at the project
 * root, never a nested folder.
 */
export type BaseDockerHelperOptions = {
  /** The current directory */
  baseRoot?: string
}

/** Options accepted by {@link createDockerfile}. */
export type DockerfileOptions = BaseDockerHelperOptions & {
  /**
   * The Zanix project type the Dockerfile should be generated for. `'server'`, `'space'`,
   * `'space-server'`, and `'app'` produce a Dockerfile — `'library'` is a no-op (nothing there
   * ever calls `Deno.serve()`, standalone or otherwise). `'app'` additionally scaffolds a
   * `serve.ts` standalone entrypoint alongside it (see {@link createDockerfile}'s own doc) — a
   * Zanix App's `mod.ts` is manifest-only, never runnable on its own. Defaults to `'server'`.
   */
  projectType?: ZanixProjects
}

/** Options accepted by {@link prepareDocker}. */
export type PrepareDockerOptions = {
  /**
   * createDockerfile options
   *   - `baseRoot`: The directory where the `Dockerfile` should be created. Defaults to `root`.
   *   - `projectType`: The Zanix project type the Dockerfile should be generated for.
   */
  dockerfile?: DockerfileOptions
  /**
   * createDockerignoreFile options
   *   - `baseRoot`: The directory where the `.dockerignore` should be created. Defaults to `root`.
   */
  dockerIgnore?: BaseDockerHelperOptions
}
