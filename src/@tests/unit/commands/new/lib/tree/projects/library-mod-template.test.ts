import { assert, assertFalse } from '@std/assert'
import {
  getLibraryModTemplate,
  getLibraryRootModTemplate,
} from 'commands/new/lib/tree/projects/library.ts'
import { PROJECT_TYPE_DEPENDENCIES } from 'utils/config/dependencies.ts'

// Regression coverage for the fix retiring `getLibrarySrcTree`'s own JSR-fetched placeholder
// (`docs/engineering.md` §5/§7) — both real content functions now live in `library.ts` itself,
// generate real (never empty) content, and import no `@zanix/*` package (`PROJECT_TYPE_DEPENDENCIES.
// library` stays `[]`), matching `getAppModTemplate`'s own dedicated coverage
// (`app-mod-template.test.ts`).

Deno.test(
  'getLibraryModTemplate: real, non-empty starter content, kebab-cased into both the doc ' +
    'comment and the example export',
  () => {
    const content = getLibraryModTemplate('My Cool Library')
    assert(content.includes('my-cool-library'), content)
    assert(content.includes('export function example'), content)
    assert(content.includes("return 'my-cool-library'"), content)
  },
)

Deno.test(
  'getLibraryModTemplate: imports nothing @zanix/* — a library scaffold declares zero ' +
    'dependencies by default',
  () => {
    const content = getLibraryModTemplate('my-library')
    assertFalse(/from ['"]@zanix\//.test(content), content)
  },
)

Deno.test(
  'getLibraryRootModTemplate: re-exports the real src/modules/mod.ts starter content — never ' +
    'declares its own inline shape',
  () => {
    const content = getLibraryRootModTemplate('My Cool Library')
    assert(content.includes("export * from './src/modules/mod.ts'"), content)
    assert(content.includes('my-cool-library'), content)
  },
)

Deno.test(
  'getLibraryRootModTemplate: imports nothing @zanix/* either',
  () => {
    const content = getLibraryRootModTemplate('my-library')
    assertFalse(/from ['"]@zanix\//.test(content), content)
  },
)

Deno.test(
  "library's dependency list stays empty — neither getLibraryModTemplate nor " +
    'getLibraryRootModTemplate ever writes a @zanix/* import',
  () => {
    assert(
      PROJECT_TYPE_DEPENDENCIES.library.length === 0,
      `expected library to declare no dependencies, got ${PROJECT_TYPE_DEPENDENCIES.library}`,
    )
  },
)
