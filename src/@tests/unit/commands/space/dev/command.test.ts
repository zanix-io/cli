import { getTemporaryFolder } from '@zanix/helpers'
import { assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import spaceDevAction from 'commands/space/dev/command.ts'
import { Commander } from 'cli'

// `spaceDevAction`'s own real orchestration (importing `space.app.ts`, wiring the dev engine,
// booting real SSR/socket servers via `bootstrapServers`) is real, live infrastructure — no
// integration test anywhere spins up `zanix space dev` end-to-end, since it never exits on its
// own (see this file's own doc). This covers the one branch that's both real AND cheap: the
// project-type guard, which must reject BEFORE any of that live orchestration ever starts.
Deno.test('spaceDevAction should throw outside a space/space-server project', async () => {
  const projectFolder = `${await Deno.makeTempDir({ dir: getTemporaryFolder(import.meta.url) })}`
  await Deno.writeTextFile(
    `${projectFolder}/deno.jsonc`,
    JSON.stringify({ zanix: { project: 'server' } }),
  )
  const mockCwd = stub(Deno, 'cwd', () => projectFolder)

  try {
    await assertRejects(
      () => spaceDevAction.call(new Commander(), {}),
      Error,
      "must be run inside a 'space' or 'space-server' project",
    )
  } finally {
    mockCwd.restore()
    await Deno.remove(projectFolder, { recursive: true })
  }
})
