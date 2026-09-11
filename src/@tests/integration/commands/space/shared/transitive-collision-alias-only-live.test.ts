import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import {
  detectTransitiveCollisionPackages,
  prepareTransitiveCollisionReexec,
} from 'commands/space/shared/transitive-collision.ts'

const TMP_ROOT = getTemporaryFolder(import.meta.url)

/**
 * End-to-end proof, against real, currently-published packages, of a second collision shape
 * `transitive-collision-reexec-live.test.ts` (this same folder) doesn't cover: a project that
 * declares its OWN direct edge into the colliding package only under a subpath ALIAS
 * (`"@zanix/errors": "jsr:@zanix/utils@^X/errors"`), never the package's own bare name
 * (`@zanix/utils` itself never appears as a literal top-level key) — a real, confirmed, widely-used
 * convention (`@zanix/auth`'s own published `deno.jsonc` declares `@zanix/errors`/`@zanix/helpers`/
 * `@zanix/validator` this exact way internally, and a real consuming project can do the same at its
 * own top level).
 *
 * `detectTransitiveCollisionPackages` attributes each direct import to its own REAL resolved
 * package identity (the name a resolved `jsr.io` URL actually reports) before checking for a
 * collision, rather than comparing against the raw alias key text — an alias-only direct edge into
 * `@zanix/utils` is flagged exactly the same way a literal `"@zanix/utils"` key would be.
 */
async function withFixtureProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ dir: TMP_ROOT })
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({
        // Needed only because a `@zanix/auth` release under 24h old otherwise fails Deno's own
        // default freshness gate for this fixture's own `deno info`/`deno install` calls — the
        // same real, currently-live gotcha `command-live-boot-guard-redirect.test.ts` (sibling
        // `dev` test directory) documents in full; unrelated to what this test itself checks.
        minimumDependencyAge: 0,
        imports: {
          '@zanix/auth': 'jsr:@zanix/auth@^1.3.0',
          // `attachRequestToError` only needs a real `Request` global attached as an own property —
          // never module-instance-sensitive itself — so any compatible version here is fine; kept
          // purely to build a realistic `redirectUnauthenticatedPageVisit` input.
          '@zanix/server': 'jsr:@zanix/server@^4.0.0',
          // No literal `"@zanix/utils"` entry anywhere — only a subpath alias, exactly the shape
          // that silently escaped detection before the base-identity fix.
          '@zanix/errors': 'jsr:@zanix/utils@^4.0.0/errors',
        },
      }),
    )
    await Deno.writeTextFile(
      join(root, 'entry.ts'),
      `import { HttpError } from '@zanix/errors'
import { attachRequestToError } from '@zanix/server'
import { redirectUnauthenticatedPageVisit } from '@zanix/auth'

const error = attachRequestToError(new HttpError('UNAUTHORIZED'), new Request('https://x.test/'))
const handler = redirectUnauthenticatedPageVisit({ loginUrl: () => '/login' })
console.log(handler(error) === undefined)
`,
    )
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test(
  'detectTransitiveCollisionPackages: flags an alias-only direct edge (@zanix/errors → ' +
    '@zanix/utils) reachable transitively through another direct import (@zanix/auth), and the ' +
    "merged config it produces converges both onto one @zanix/utils instance — 'HttpError' " +
    "constructed from the alias satisfies `instanceof` inside the dependency's own composed check",
  async () => {
    await withFixtureProject(async (root) => {
      const collisions = await detectTransitiveCollisionPackages(root)
      assert(
        collisions.has('@zanix/errors'),
        `expected the alias '@zanix/errors' to be flagged (found: ${
          [...collisions].join(', ') || '(none)'
        })`,
      )

      const mergedConfigPath = await prepareTransitiveCollisionReexec(root)
      assert(mergedConfigPath !== undefined, 'expected a merged config path for a flagged project')

      // A separate subprocess, simulating a differently-configured governing process (the shape
      // `zanix space dev`'s own global-install shim takes) — it has NO knowledge of `root` beyond
      // the `--config` flag itself.
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', '--config', mergedConfigPath as string, join(root, 'entry.ts')],
        stdout: 'piped',
        stderr: 'piped',
      })
      const { success, stdout, stderr } = await command.output()
      const stdoutText = new TextDecoder().decode(stdout).trim()
      assert(
        success,
        `expected the re-exec'd process to boot successfully; stderr: ${
          new TextDecoder().decode(stderr)
        }`,
      )
      assertEquals(
        stdoutText,
        'false',
        `expected 'false' (the composed handler recognizes the error and returns a Response, ` +
          `never 'undefined') — got '${stdoutText}' instead, meaning the entry file's own ` +
          "'HttpError' and @zanix/auth's own internal one resolved to two separate instances even " +
          'under the merged config.',
      )
    })
  },
)
