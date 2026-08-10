import { assertEquals, assertThrows } from '@std/assert'
import {
  assembleScaffold,
  resolveRecipe,
  type ScaffoldRecipeEntry,
  type ScaffoldRecipeRegistry,
} from 'commands/new/lib/tree/recipe.ts'

interface FakeLeaf {
  FOLDER: string
  templates: { base: { PATH: string; NAME: string; content: () => Promise<string> }[] }
}

interface FakeTree {
  subfolders: {
    a: FakeLeaf
    b: FakeLeaf
  }
}

function makeFakeTree(): FakeTree {
  return {
    subfolders: {
      a: { FOLDER: '/root/a', templates: { base: [] } },
      b: { FOLDER: '/root/b', templates: { base: [] } },
    },
  }
}

Deno.test("assembleScaffold writes each entry's planned files onto its own leaf", () => {
  const tree = makeFakeTree()
  const recipe: ScaffoldRecipeEntry<FakeTree>[] = [
    {
      leaf: (t) => t.subfolders.a,
      plan: (folder) => ({
        files: [{ PATH: `${folder}/one.ts`, NAME: 'one.ts', content: () => Promise.resolve('a') }],
      }),
    },
    {
      leaf: (t) => t.subfolders.b,
      plan: (folder) => ({
        files: [{ PATH: `${folder}/two.ts`, NAME: 'two.ts', content: () => Promise.resolve('b') }],
      }),
    },
  ]

  assembleScaffold(tree, recipe)

  assertEquals(tree.subfolders.a.templates.base.map((f) => f.NAME), ['one.ts'])
  assertEquals(tree.subfolders.b.templates.base.map((f) => f.NAME), ['two.ts'])
})

Deno.test('assembleScaffold appends onto a leaf with content — never replaces it', () => {
  // The real-world case: `app`'s recipe targets the whole-project root node, which `commons.ts`
  // already populated with README.md/LICENSE/etc. before any recipe ever runs. A leaf starting
  // non-empty must keep that content after assembleScaffold runs.
  const tree = makeFakeTree()
  tree.subfolders.a.templates.base.push({
    PATH: '/root/a/README.md',
    NAME: 'README.md',
    content: () => Promise.resolve('readme'),
  })

  const recipe: ScaffoldRecipeEntry<FakeTree>[] = [
    {
      leaf: (t) => t.subfolders.a,
      plan: (folder) => ({
        files: [{
          PATH: `${folder}/mod.ts`,
          NAME: 'mod.ts',
          content: () => Promise.resolve('mod'),
        }],
      }),
    },
  ]

  assembleScaffold(tree, recipe)

  assertEquals(tree.subfolders.a.templates.base.map((f) => f.NAME), ['README.md', 'mod.ts'])
})

Deno.test("assembleScaffold passes each leaf's own FOLDER into its plan", () => {
  const tree = makeFakeTree()
  const seenFolders: string[] = []
  const recipe: ScaffoldRecipeEntry<FakeTree>[] = [
    {
      leaf: (t) => t.subfolders.a,
      plan: (folder) => {
        seenFolders.push(folder)
        return { files: [] }
      },
    },
    {
      leaf: (t) => t.subfolders.b,
      plan: (folder) => {
        seenFolders.push(folder)
        return { files: [] }
      },
    },
  ]

  assembleScaffold(tree, recipe)

  assertEquals(seenFolders, ['/root/a', '/root/b'])
})

Deno.test('assembleScaffold supports a plan returning extra fields beyond files', () => {
  // Mirrors planRto/planSeeder, which return {files, ensureConstants}/{files, ensureHelper} —
  // assembleScaffold must only ever read `.files`, ignoring whatever else the plan returns.
  const tree = makeFakeTree()
  const recipe: ScaffoldRecipeEntry<FakeTree>[] = [
    {
      leaf: (t) => t.subfolders.a,
      plan: (folder) => ({
        files: [{ PATH: `${folder}/x.ts`, NAME: 'x.ts', content: () => Promise.resolve('x') }],
        ensureConstants: async () => {},
      }),
    },
  ]

  assembleScaffold(tree, recipe)

  assertEquals(tree.subfolders.a.templates.base.map((f) => f.NAME), ['x.ts'])
})

Deno.test('resolveRecipe returns the registry entry for a known preset', () => {
  const baseRecipe: ScaffoldRecipeEntry<FakeTree>[] = [
    { leaf: (t) => t.subfolders.a, plan: () => ({ files: [] }) },
  ]
  const registry: ScaffoldRecipeRegistry<FakeTree> = { base: baseRecipe }

  assertEquals(resolveRecipe(registry, 'base'), baseRecipe)
})

Deno.test('resolveRecipe throws a clear, listing error for an unknown preset', () => {
  const registry: ScaffoldRecipeRegistry<FakeTree> = {
    base: [{ leaf: (t) => t.subfolders.a, plan: () => ({ files: [] }) }],
  }

  const error = assertThrows(
    () => resolveRecipe(registry, 'does-not-exist'),
    Error,
    "Unknown template 'does-not-exist'",
  )
  assertEquals(error.message, "Unknown template 'does-not-exist'. Supported templates: base.")
})

Deno.test('a 2nd preset needs only a new registry entry — assembleScaffold never changes', () => {
  // Proves the extensibility contract `presets.ts`/`recipe.ts` document: adding preset #2 for a
  // project type is a registry entry, nothing else. Two distinct recipes for the same fake project
  // type, resolved independently, each producing its own tree without the other ever running.
  const baseRecipe: ScaffoldRecipeEntry<FakeTree>[] = [
    {
      leaf: (t) => t.subfolders.a,
      plan: (folder) => ({
        files: [{
          PATH: `${folder}/base.ts`,
          NAME: 'base.ts',
          content: () => Promise.resolve('base'),
        }],
      }),
    },
  ]
  const altRecipe: ScaffoldRecipeEntry<FakeTree>[] = [
    {
      leaf: (t) => t.subfolders.a,
      plan: (folder) => ({
        files: [{
          PATH: `${folder}/alt.ts`,
          NAME: 'alt.ts',
          content: () => Promise.resolve('alt'),
        }],
      }),
    },
  ]
  const registry: ScaffoldRecipeRegistry<FakeTree> = { base: baseRecipe, alt: altRecipe }

  const baseTree = makeFakeTree()
  assembleScaffold(baseTree, resolveRecipe(registry, 'base'))
  assertEquals(baseTree.subfolders.a.templates.base.map((f) => f.NAME), ['base.ts'])

  const altTree = makeFakeTree()
  assembleScaffold(altTree, resolveRecipe(registry, 'alt'))
  assertEquals(altTree.subfolders.a.templates.base.map((f) => f.NAME), ['alt.ts'])
})
