import { createDockerfile } from 'commands/prepare/lib/docker/files/docker-file.ts'
import { createDockerignoreFile } from 'commands/prepare/lib/docker/files/dockerignore.ts'
import { ensureAppServeTask } from 'commands/prepare/lib/docker/files/app-entrypoint.ts'
import { prepareDocker } from 'commands/prepare/lib/docker/prepare.ts'
import { fileExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertFalse } from '@std/assert'
import { stub } from '@std/testing/mock'

const defaultFolder = getTemporaryFolder(import.meta.url) + '/docker'

// Disable console
stub(console, 'info')
stub(console, 'error')
stub(console, 'warn')

Deno.test('Docker create Dockerfile for a server project', async () => {
  const response = await createDockerfile({
    baseRoot: defaultFolder,
    projectType: 'server',
  })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')

  assert(content.includes('8000'))
  assert(content.includes('mod.ts'))
  assert(content.includes('deno cache'))
  assertFalse(content.includes('deno install'))
  assertFalse(content.includes('node_modules'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile for a space project', async () => {
  const response = await createDockerfile({
    baseRoot: defaultFolder,
    projectType: 'space',
  })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')

  assert(content.includes('deno install'))
  // Installs the `zanix` binary globally FIRST (not on PATH in a fresh `denoland/deno` image),
  // then builds via this project's own declared `deno task build` — never a second,
  // independently-maintained `deno run -A jsr:@zanix/cli space build` invocation.
  assert(content.includes('deno install -A -g -n zanix jsr:@zanix/cli'))
  assert(content.includes('RUN deno task build'))
  assert(!content.includes('deno run -A jsr:@zanix/cli space build'))
  assert(content.includes('dist/client'))
  assert(content.includes('COPY --from=build'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))

  // The RUNTIME stage copies explicit, minimal paths — never a blanket `COPY . .` there (the
  // BUILD stage above it still legitimately does, exactly once, to have the full source available
  // for `zanix space build`). Confirms the fix for a real bug: the runtime stage used to also
  // `COPY . .`, shipping `theme/`/`messages/`/`docs/`/tests/etc. that production never reads.
  assertEquals(content.match(/^COPY \. \.$/gm)?.length, 1)
  assert(content.includes('COPY src ./src'))
  assert(content.includes('COPY deno.json* deno.jsonc* deno.lock* mod.ts space.app.ts ./'))
  // Never copied into the runtime image — `assetsPlugin` already emits every `assetsDir` file
  // into `dist/client/assets/` at build time, and a raw `COPY assets ./assets` here would both
  // duplicate that AND fail outright for a project with no `assetsDir` (or an empty one) at all.
  // Anchored to an actual instruction LINE (no leading `#`) — the surrounding comment legitimately
  // mentions the same string as guidance for when to add it back by hand.
  assertFalse(/^COPY assets/m.test(content))
  assert(!content.includes('COPY theme'))
  assert(!content.includes('COPY messages'))
  assert(!content.includes('COPY docs'))
  assert(!content.includes('COPY README'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile for a space-server project', async () => {
  const response = await createDockerfile({
    baseRoot: defaultFolder,
    projectType: 'space-server',
  })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')

  assert(content.includes('deno install'))
  // Installs the `zanix` binary globally FIRST (not on PATH in a fresh `denoland/deno` image),
  // then builds via this project's own declared `deno task build` — never a second,
  // independently-maintained `deno run -A jsr:@zanix/cli space build` invocation.
  assert(content.includes('deno install -A -g -n zanix jsr:@zanix/cli'))
  assert(content.includes('RUN deno task build'))
  assert(!content.includes('deno run -A jsr:@zanix/cli space build'))
  assert(content.includes('dist/client'))
  assert(content.includes('COPY --from=build'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))
  assertEquals(content.match(/^COPY \. \.$/gm)?.length, 1)
  assert(content.includes('COPY src ./src'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile returns false for a library project', async () => {
  const response = await createDockerfile({
    baseRoot: defaultFolder,
    projectType: 'library',
  })
  assertFalse(response)
  assertFalse(fileExists(defaultFolder + '/Dockerfile'))
})

Deno.test('Docker create Dockerfile for an app project also scaffolds serve.ts', async () => {
  const response = await createDockerfile({
    baseRoot: defaultFolder,
    projectType: 'app',
  })
  assert(response)

  const content = await Deno.readTextFile(defaultFolder + '/Dockerfile')
  assert(content.includes('serve.ts'))
  assert(content.includes('deno cache'))
  assertFalse(content.includes('deno install'))
  assertFalse(content.includes('node_modules'))
  assertFalse(/\$\{[A-Z_]+\}/.test(content))

  const serveContent = await Deno.readTextFile(defaultFolder + '/serve.ts')
  assert(serveContent.includes('bootstrapRemoteApp'))
  assert(serveContent.includes("from './mod.ts'"))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test(
  'ensureAppServeTask adds a serve task, preserving every other existing field',
  async () => {
    await Deno.mkdir(defaultFolder, { recursive: true })
    await Deno.writeTextFile(
      defaultFolder + '/deno.json',
      JSON.stringify(
        { name: '@acme/my-app', tasks: { custom: 'echo hi' } },
        null,
        2,
      ),
    )

    const response = await ensureAppServeTask(defaultFolder)
    assert(response)

    const config = JSON.parse(
      await Deno.readTextFile(defaultFolder + '/deno.json'),
    )
    assertEquals(config.name, '@acme/my-app')
    assertEquals(config.tasks.custom, 'echo hi')
    assert(config.tasks.serve.includes('serve.ts'))
    assert(config.tasks.serve.includes('--allow-net'))

    await Deno.remove(defaultFolder, { recursive: true })
  },
)

Deno.test('ensureAppServeTask never overwrites an existing serve task', async () => {
  await Deno.mkdir(defaultFolder, { recursive: true })
  await Deno.writeTextFile(
    defaultFolder + '/deno.json',
    JSON.stringify({ tasks: { serve: 'echo custom-serve' } }, null, 2),
  )

  const response = await ensureAppServeTask(defaultFolder)
  assertFalse(response)

  const config = JSON.parse(
    await Deno.readTextFile(defaultFolder + '/deno.json'),
  )
  assertEquals(config.tasks.serve, 'echo custom-serve')

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create Dockerfile for app skips serve.ts if it already exists', async () => {
  await Deno.mkdir(defaultFolder, { recursive: true })
  await Deno.writeTextFile(
    defaultFolder + '/serve.ts',
    '// custom, do not overwrite\n',
  )

  await createDockerfile({ baseRoot: defaultFolder, projectType: 'app' })

  const serveContent = await Deno.readTextFile(defaultFolder + '/serve.ts')
  assertEquals(serveContent, '// custom, do not overwrite\n')

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker Dockerfile creation skips when the file already exists', async () => {
  await createDockerfile({ baseRoot: defaultFolder, projectType: 'server' })
  const response = await createDockerfile({
    baseRoot: defaultFolder,
    projectType: 'server',
  })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker create .dockerignore validation', async () => {
  const response = await createDockerignoreFile({ baseRoot: defaultFolder })
  assert(response)
  assert(fileExists(defaultFolder + '/.dockerignore'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker .dockerignore creation skips when the file already exists', async () => {
  await createDockerignoreFile({ baseRoot: defaultFolder })
  const response = await createDockerignoreFile({ baseRoot: defaultFolder })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Docker prepare validation writes both files for a server project', async () => {
  const response = await prepareDocker({
    dockerfile: { baseRoot: defaultFolder, projectType: 'server' },
    dockerIgnore: { baseRoot: defaultFolder },
  })

  assert(response.length === 2 && !response.includes(false))
  assert(fileExists(defaultFolder + '/Dockerfile'))
  assert(fileExists(defaultFolder + '/.dockerignore'))

  await Deno.remove(defaultFolder, { recursive: true })
})
