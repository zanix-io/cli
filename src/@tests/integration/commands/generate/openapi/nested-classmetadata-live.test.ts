import { assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { planOpenapiSpec } from 'commands/generate/openapi/spec-builder.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * A real, currently-published `@zanix/utils` (`jsr:@zanix/utils@3.0.1`, confirmed directly against
 * its own published `nested.ts`/`main.ts` source) doesn't tag `ValidateNested` or report stacked
 * decorators yet — both are local-checkout-only, unpublished `@zanix/utils` changes as of this
 * writing (see `discover.ts`'s own module doc). Proving `discover.ts`'s recursive resolution and
 * `spec-builder.ts`'s nested/stacked-decorator mapping against the REAL upstream shape therefore
 * means running against the local `../../../../../../../utils` checkout directly, not a `deno.json`
 * pin `deno.lock` could ever resolve today.
 *
 * `discoverRoutes`'s own subprocess can't be reused here as-is: it unconditionally imports
 * `@zanix/core`/`@zanix/server` too, and `@zanix/core`'s real, currently-published version doesn't
 * support `Zanix.compose` yet either (a separate, known gap — see
 * `commands.generate.openapi.test.ts`'s own doc) — routing this check through it would test that
 * unrelated, already-tracked gap instead of the one this file actually verifies. `MIRROR_SCRIPT`
 * below is therefore a deliberate, minimal duplicate of `discover.ts`'s own
 * `resolveNestedRtoFields`/`resolveNestedDecoratorEntry` — real `@zanix/utils` classes, run through
 * the exact same resolution algorithm, in a real `deno run` subprocess rooted at a real local
 * `@zanix/utils` checkout, with NO subprocess-boundary shortcut. Keep it in sync with `discover.ts`
 * by hand if that algorithm changes — the same "kept in sync on purpose" discipline `rto`'s own
 * parser/renderer split already follows.
 */
const MIRROR_SCRIPT = `
import { BaseRTO, classMetadata, IsString, Length, ValidateNested } from 'modules/validations/mod.ts'

class AddressRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor city!: string
}

class UserRTO extends BaseRTO {
  @IsString({ expose: true })
  @Length({ min: 1, max: 50 })
  accessor name!: string

  @ValidateNested(AddressRTO)
  accessor address!: AddressRTO
}

const MAX_NESTED_RTO_DEPTH = 8

function resolveNestedDecoratorEntry(entry, depth) {
  if (entry.decorator !== 'ValidateNested' || typeof entry.args[0] !== 'function') return
  const nestedFields = classMetadata(entry.args[0])
  if (depth < MAX_NESTED_RTO_DEPTH) resolveNestedRtoFields(nestedFields, depth + 1)
  entry.args[0] = nestedFields
}

function resolveNestedRtoFields(fields, depth) {
  for (const field of Object.values(fields)) {
    resolveNestedDecoratorEntry(field, depth)
    if (field.decorators) {
      for (const entry of field.decorators) resolveNestedDecoratorEntry(entry, depth)
    }
  }
  return fields
}

console.log(JSON.stringify(resolveNestedRtoFields(classMetadata(UserRTO), 0)))
`

/** The local `@zanix/utils` checkout this repo's own `deno.jsonc` already assumes as a real sibling
 * folder for its other TEMP local path overrides (`../space`, `../space-ui`) — same convention,
 * applied here at the filesystem level instead of through an import map, since this spawns its own
 * standalone subprocess rather than resolving through `cli`'s own module graph. */
const UTILS_CHECKOUT = join(dirname(fromFileUrl(import.meta.url)), '../../../../../../../utils')

/** Runs {@linkcode MIRROR_SCRIPT} in a real `deno run` subprocess, resolving `modules/validations/
 * mod.ts` straight against the local `@zanix/utils` checkout's own `src/` — the real, currently
 * unpublished `classMetadata`/`ValidateNested`/stacked-decorators behavior, not a mock of it. */
async function runMirrorScript(): Promise<unknown> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })

  await Deno.writeTextFile(
    join(root, 'deno.json'),
    JSON.stringify({
      imports: {
        'typings/': `${UTILS_CHECKOUT}/src/typings/`,
        'utils/': `${UTILS_CHECKOUT}/src/utils/`,
        'modules/': `${UTILS_CHECKOUT}/src/modules/`,
      },
    }),
  )
  await Deno.writeTextFile(join(root, 'script.ts'), MIRROR_SCRIPT)

  try {
    const { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', '--min-dep-age', '0', 'script.ts'],
      cwd: root,
      stdout: 'piped',
      stderr: 'piped',
    }).output()

    if (!success) {
      throw new Error(`Mirror script failed:\n${new TextDecoder().decode(stderr)}`)
    }

    return JSON.parse(new TextDecoder().decode(stdout).trim())
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'a real ValidateNested + stacked-decorators field resolves to a correct nested/merged ' +
    'openapi.json schema end-to-end, against the real local @zanix/utils checkout',
  async () => {
    const resolvedFields = await runMirrorScript()

    const spec = planOpenapiSpec([
      {
        httpMethod: 'POST',
        path: '/users',
        application: 'main',
        rto: { Body: resolvedFields as never },
      },
    ])

    const schema = spec.paths['/users'].post?.requestBody?.content['application/json'].schema

    assertEquals(schema, {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 50 },
        address: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      required: ['name', 'address'],
    })
  },
)
