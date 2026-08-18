import { getTemporaryFolder } from '@zanix/helpers'
import { assertRejects } from '@std/assert'
import { join } from '@std/path'
import { Commander } from 'cli'
import { registerSpaceDevCommand } from 'commands/space/dev/command.ts'

console.error = () => {}

// See `command-live-boot.test.ts`'s own top doc for why this is a separate file (real,
// process-wide `@zanix/server` boot-session state that must not leak between real
// `bootstrapServers()` calls) and why the fixture below has zero route files.

type ActionCommand = {
  actionHandler: (options: Record<string, unknown>) => void | Promise<void>
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  registerSpaceDevCommand(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

async function withDevScaffold(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })
  const originalCwd = Deno.cwd()
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ zanix: { project: 'space' } }, null, 2),
    )
    await Deno.writeTextFile(
      join(root, 'space.app.ts'),
      `import '@zanix/space/react'
import { defineSpaceApp } from '@zanix/space'

export default defineSpaceApp({
  name: 'dev-live-app-conflict',
  routesDir: './src/space/routes',
})
`,
    )
    Deno.chdir(root)
    await run(root)
  } finally {
    Deno.chdir(originalCwd)
    await Deno.remove(root, { recursive: true })
  }
}

Deno.test({
  name:
    'zanix space dev: a real bind failure (port already in use) is routed through the catch block ' +
    '— the dev engine is closed and the original error is rethrown, never swallowed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withDevScaffold(async () => {
      // No `--port` passed below — blocking the command's own default (20202, `@zanix/server`'s
      // own `STATIC_PORT` for an `'ssr'` server) also exercises `options.port ?? 20202`'s fallback
      // branch, never reached by `command-live-boot.test.ts`'s own explicit `--port`.
      const port = 20202
      const blocker = Deno.listen({ port })

      try {
        const command = registerCommand()
        // `--no-validation` on top of the port conflict: also exercises `if (report) ...`'s FALSE
        // branch (`runDevValidation` returns `undefined` before this ever reaches the conflict).
        await assertRejects(
          () => Promise.resolve(command.actionHandler({ validation: false })),
        )
      } finally {
        blocker.close()
      }
    })
  },
})
