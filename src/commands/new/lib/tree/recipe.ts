import type { ZanixTemplatesRecord } from '@zanix/types'

/**
 * The shared file shape every `plan<Name>` function returns (`{PATH, NAME, content}`) — the same
 * one `ZanixTemplatesRecord['base']` itself expects, and every generator's own `command.ts`
 * already independently declares its own `Plan<Name>File` interface for. Kept separate from those
 * per-artifact types on purpose (no import cycle between `generate/` and this module), even though
 * the shape is identical everywhere — structural typing means any of them satisfies this one.
 */
export interface ScaffoldPlanFile {
  PATH: string
  NAME: string
  content: () => Promise<string>
}

/** A deferred, cross-tree write a plan needs beyond its own leaf's files — `planRto`'s
 * `ensureConstants`/`planSeeder`'s `ensureHelper` are both this shape already; a recipe entry
 * whose plan targets a file outside its own leaf folder (or needs append-if-missing semantics
 * `createFilesAndFolders`'s own "skip if the whole file exists" doesn't give it) returns one of
 * these instead of trying to force that write through `files`. */
export type ScaffoldSideEffect = (root: string) => Promise<void>

/** The part of a `ZanixBaseFolder` node a recipe entry needs: where to write, and where to attach
 * the planned files. */
export interface ScaffoldLeaf {
  readonly FOLDER: string
  templates: ZanixTemplatesRecord
}

/**
 * One project-type scaffold leaf: which node in the already-built tree skeleton to populate
 * (`leaf`), and which `plan<Name>` call produces its content (`plan`) — the placeholder
 * `'example'`/`'Example'` arguments a real `plan<Name>` call needs are baked into the closure at
 * the recipe's own definition site, not threaded through this generic type. `plan` may return
 * `sideEffects` alongside `files` — structurally, this is exactly what `planRto`/`planSeeder`
 * already return (`ensureConstants`/`ensureHelper`, adapted to this array shape at the recipe's own
 * definition site, same as the placeholder arguments).
 */
export interface ScaffoldRecipeEntry<Tree> {
  leaf: (tree: Tree) => ScaffoldLeaf
  plan: (
    folder: string,
  ) => { files: ScaffoldPlanFile[]; sideEffects?: ScaffoldSideEffect[] }
}

/**
 * Runs every entry in `recipe` against the already-built `tree` skeleton (from `ZanixTree.create`),
 * appending each leaf's planned files onto its `templates.base` and returning every collected
 * `sideEffects` entry, flattened, in recipe order. This is the "Scaffold Assembler"
 * `cli`'s own `docs/engineering.md` (§6.1) describes: one shared loop over a
 * declarative list, rather than a hand-written imperative assignment block per leaf repeated,
 * near-identically, in both `server.ts` and `space.ts` — adding leaf #N to a project type's
 * scaffold is adding one entry to its own recipe array, not writing a new imperative block.
 *
 * Appends, deliberately not `leaf.templates = { base: plan.files }` (a full replace) — every leaf
 * `server`/`space` populate this way starts as an empty placeholder (`{ base: [] }`, see
 * `SERVER_RECIPE_BASE`'s/`SPACE_RECIPE_BASE`'s own comment), so append and replace are
 * indistinguishable there. They stop being interchangeable the moment a recipe's `leaf` resolves to
 * a node that already carries real content before this function runs — the whole-project ROOT node,
 * which `commons.ts` (`getCommonTree`) always pre-populates with `README.md`/`CHANGELOG.md`/
 * `LICENSE`/etc. `app`'s own recipe (`APP_RECIPES`, `projects/app.ts`) targets exactly that root
 * node for its `mod.ts` entry — a replace there would silently wipe every file `commons.ts` already
 * wrote. Append is the correct semantics for every recipe, existing or future: a recipe entry adds
 * to what a leaf already has, never assumes it owns that leaf exclusively.
 *
 * The returned side effects are never run here — they must run strictly after
 * `createFilesAndFolders` actually writes the files this function only plans (same ordering
 * `ensureConstants`/`ensureHelper` already required before this function existed). The caller
 * (each project type's own `ensure<Type>ScaffoldSideEffects`) is what actually awaits them, once,
 * after that write completes — but it no longer needs to know *which* leaves have side effects or
 * call each one by name: it only has to run whatever this function handed back, so a future recipe
 * entry that adds a `sideEffects` array is picked up automatically, not silently dropped the way a
 * hand-maintained list could be.
 */
export function assembleScaffold<Tree>(
  tree: Tree,
  recipe: ScaffoldRecipeEntry<Tree>[],
): ScaffoldSideEffect[] {
  const sideEffects: ScaffoldSideEffect[] = []

  for (const entry of recipe) {
    const leaf = entry.leaf(tree)
    const plan = entry.plan(leaf.FOLDER)
    leaf.templates = { base: [...leaf.templates.base, ...plan.files] }
    if (plan.sideEffects) sideEffects.push(...plan.sideEffects)
  }

  return sideEffects
}

/**
 * A project type's full set of named presets — `zanix new <type> --template <preset>` resolves
 * here. `app.ts`'s `APP_RECIPES` is still just `{ base: [...] }` (a single root `mod.ts` entry has
 * nothing else to vary on); `server.ts`'s `SERVER_RECIPES` and `space.ts`'s `getSpaceRecipes(theme,
 * renderer)` have since grown real preset #2/#3/#4 content (`welcome`/`population`/
 * `population-lang`) — either way, adding one more entry to the object literal is all a new preset
 * needs: `resolveRecipe`/`assembleScaffold` and every generator's own `command.ts` stay untouched.
 */
export type ScaffoldRecipeRegistry<Tree> = Record<
  string,
  ScaffoldRecipeEntry<Tree>[]
>

/**
 * Resolves `preset` against a project type's own `registry`, throwing a plain `Error` (same
 * never-`this.throw`-directly convention as `presets.ts`'s own `assertKnownPreset` — the caller,
 * one of `new/actions/`'s own action functions, catches this and re-throws via `this.throw`) if
 * that project type doesn't define a recipe for it. Called before any tree is built for
 * `server`/`space`/`app` specifically — the three project types that actually have a
 * `ScaffoldRecipeRegistry` of their own (`library` has none; see `presets.ts`'s own
 * `assertKnownPreset` doc for how it's validated instead) — so an invalid `--template` fails fast,
 * before `createFilesAndFolders` ever runs.
 */
export function resolveRecipe<Tree>(
  registry: ScaffoldRecipeRegistry<Tree>,
  preset: string,
): ScaffoldRecipeEntry<Tree>[] {
  const recipe = registry[preset]
  if (!recipe) {
    throw new Error(
      `Unknown template '${preset}'. Supported templates: ${Object.keys(registry).join(', ')}.`,
    )
  }
  return recipe
}
