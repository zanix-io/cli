import { createPreCommitHook } from 'commands/prepare/lib/github/hooks/pre-commit.ts'
import { createPrePushHook } from 'commands/prepare/lib/github/hooks/pre-push.ts'
import { createGitWorkflows } from 'commands/prepare/lib/github/workflows/workflow.ts'
import { createWorkflow } from 'commands/prepare/lib/github/workflows/main.ts'
import { prepareGithub } from 'commands/prepare/lib/github/prepare.ts'
import { createIgnoreBaseFile } from 'commands/prepare/lib/github/files/main.ts'
import { fileExists, folderExists, getTemporaryFolder } from '@zanix/helpers'
import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { gitInitialization } from 'commands/prepare/lib/github/hooks/main.ts'

const defaultFolder = getTemporaryFolder(import.meta.url) + '/github'

// Disable console
stub(console, 'info')
stub(console, 'error')
stub(console, 'warn')

Deno.test('Github create pre-commit hook validation', async () => {
  await gitInitialization(defaultFolder)
  // Call the function passing the file type, for example 'ts'
  const response = await createPreCommitHook({
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
    filePatterns: {
      lint: [
        'ts',
      ],
      fmt: ['ts', 'md'],
    },
  })
  assert(response)
  assert(fileExists(defaultFolder + '/pre-commit'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create pre-commit hook skips creation when the file already exists', async () => {
  await gitInitialization(defaultFolder)
  const hookOptions = {
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
  }

  await createPreCommitHook(hookOptions)
  const response = await createPreCommitHook(hookOptions)

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Git initialization skips `git init` when the repository already exists', async () => {
  await gitInitialization(defaultFolder) // creates the repository
  const gitHooksFolder = await gitInitialization(defaultFolder) // repository already exists

  assertEquals(gitHooksFolder, defaultFolder + '/.git/hooks')
  assert(folderExists(defaultFolder + '/.git'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create pre-push hook validation', async () => {
  await gitInitialization(defaultFolder)
  // Call the function passing the file type, for example 'ts'
  const response = await createPrePushHook({
    baseFolder: defaultFolder,
    baseRoot: '',
    createLink: false,
  })
  assert(response)
  assert(fileExists(defaultFolder + '/pre-push'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github creates ci.yml and publish.yml with mainBranch substitution', async () => {
  await gitInitialization(defaultFolder)
  // Default `projectType` ('library') writes BOTH files.
  const response = await createGitWorkflows({
    baseFolder: defaultFolder,
    baseRoot: '',
    mainBranch: 'myCustomBranch',
  })
  assert(response)

  for (const filename of ['ci.yml', 'publish.yml']) {
    // deno-lint-ignore no-await-in-loop
    const content = await Deno.readTextFile(`${defaultFolder}/${filename}`)

    assert(
      content.includes(`pull_request:
    branches:
      - myCustomBranch
  push:
    branches:
      - myCustomBranch`),
      `expected '${filename}' to substitute the custom main branch`,
    )
  }

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test(
  "'ci.yml'/'publish.yml' are linked, not two disconnected parallel runs: 'publish.yml' calls " +
    "'ci.yml' as a reusable workflow and its 'publish' job needs the calling job to succeed first",
  async () => {
    await gitInitialization(defaultFolder)
    // `'library'` (the default) is the one project type that gets BOTH files.
    await createGitWorkflows({ baseFolder: defaultFolder, baseRoot: '' })

    const ciContent = await Deno.readTextFile(defaultFolder + '/ci.yml')
    const publishContent = await Deno.readTextFile(defaultFolder + '/publish.yml')

    // `ci.yml`: checkout, Setup Deno, fmt check, lint, check-cycles — no test step, no publish
    // step. Also callable as a reusable workflow (not just standalone push/PR-triggered).
    assert(
      ciContent.includes('run: deno fmt --check'),
      "expected 'ci.yml' to run 'deno fmt --check'",
    )
    assert(ciContent.includes('run: deno lint'), "expected 'ci.yml' to run 'deno lint'")
    assert(
      ciContent.includes('run: deno run -A jsr:@zanix/cli check-cycles'),
      "expected 'ci.yml' to run check-cycles",
    )
    assertFalse(ciContent.includes('Run tests'), "'ci.yml' must not duplicate the test step")
    assertFalse(
      ciContent.includes('Publish to Deno'),
      "'ci.yml' must not contain a publish step",
    )
    assert(ciContent.includes('workflow_call'), "expected 'ci.yml' to declare 'workflow_call'")

    // `publish.yml`: checkout, Setup Deno, tests, publish — no check-cycles step of its own (that
    // check is delegated to the `ci` job, which invokes `ci.yml` as a reusable workflow); the real,
    // load-bearing dependency this test locks in — not just "the step string is absent" — is that
    // `publish` actually can't run before `ci` succeeds.
    assert(
      publishContent.includes('run: deno test --allow-all'),
      "expected 'publish.yml' to run tests",
    )
    assert(publishContent.includes('Publish to Deno'), "expected 'publish.yml' to run publish")
    assertFalse(
      publishContent.includes('Check for circular-import hazards'),
      "'publish.yml' must not duplicate the check-cycles step",
    )
    assert(
      publishContent.includes('uses: ./.github/workflows/ci.yml'),
      "expected 'publish.yml' to have a job that calls 'ci.yml' as a reusable workflow",
    )
    assert(
      /needs:\s*ci\b/.test(publishContent),
      "expected the 'publish' job to declare 'needs: ci'",
    )
    // The `needs: ci` reference must actually resolve to the job that calls `ci.yml` — not a
    // same-named but unrelated job — so assert the job key AND its `uses:` line are the same job.
    const ciJobIndex = publishContent.indexOf('ci:')
    const usesIndex = publishContent.indexOf('uses: ./.github/workflows/ci.yml')
    const needsIndex = publishContent.indexOf('needs: ci')
    assert(
      ciJobIndex > -1 && ciJobIndex < usesIndex && usesIndex < needsIndex,
      "expected the 'ci:' job (with its 'uses:') to be declared before the 'publish' job's 'needs: ci'",
    )
    // The job-level `needs: ci` default (skip `publish` entirely if `ci` failed) is easy to
    // silently defeat later (e.g. adding `if: always()` to the `publish` job for diagnostics) —
    // lock in that the `Publish to Deno` STEP ALSO checks `needs.ci.result` explicitly, so the
    // guarantee survives even if the job-level default stops holding.
    assert(
      /if:\s*success\(\)\s*&&\s*needs\.ci\.result\s*==\s*'success'\s*&&\s*github\.event_name\s*==\s*'push'/
        .test(publishContent),
      "expected the 'Publish to Deno' step to explicitly gate on needs.ci.result == 'success'",
    )

    await Deno.remove(defaultFolder, { recursive: true })
  },
)

Deno.test('Github workflows skip creation when the YAML(s) already exist', async () => {
  await gitInitialization(defaultFolder)
  const workflowOptions = { baseFolder: defaultFolder, baseRoot: '' }

  await createGitWorkflows(workflowOptions)
  const response = await createGitWorkflows(workflowOptions)

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('createWorkflow defaults to the identity callback', async () => {
  const response = await createWorkflow({
    filename: 'publish',
    baseFolder: defaultFolder,
    baseRoot: '',
  })

  assert(response)
  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test(
  "Github creates ONLY 'ci.yml' (check-cycles, no tests, no publish) for non-publishable project types",
  async () => {
    // Sequential on purpose, not `Promise.all` — both iterations write/read the same
    // `defaultFolder`, matching `github.test.ts` (unit)'s own identical reasoning for its
    // `server`/`space`/`space-server` loop.
    for (const projectType of ['server', 'space', 'space-server'] as const) {
      // deno-lint-ignore no-await-in-loop
      await gitInitialization(defaultFolder)
      // deno-lint-ignore no-await-in-loop
      const response = await createGitWorkflows({
        baseFolder: defaultFolder,
        baseRoot: '',
        projectType,
      })
      assert(response, `expected 'ci.yml' to be created for projectType '${projectType}'`)

      // deno-lint-ignore no-await-in-loop
      const content = await Deno.readTextFile(defaultFolder + '/ci.yml')

      assert(content.includes('run: deno fmt --check'))
      assert(content.includes('run: deno lint'))
      assert(content.includes('run: deno run -A jsr:@zanix/cli check-cycles'))
      assertFalse(
        content.includes('Run tests'),
        `'ci.yml' must not run tests for projectType '${projectType}'`,
      )
      assertFalse(
        content.includes('Publish to Deno'),
        `'ci.yml' must not contain a publish step for projectType '${projectType}'`,
      )
      assertFalse(fileExists(defaultFolder + '/publish.yml'))

      // deno-lint-ignore no-await-in-loop
      await Deno.remove(defaultFolder, { recursive: true })
    }
  },
)

Deno.test(
  "Github creates BOTH 'ci.yml' and 'publish.yml' for 'library'/'app', neither duplicating the other's step",
  async () => {
    // Sequential on purpose — same reasoning as the non-publishable-type test right above.
    for (const projectType of ['library', 'app'] as const) {
      // deno-lint-ignore no-await-in-loop
      await gitInitialization(defaultFolder)
      // deno-lint-ignore no-await-in-loop
      const response = await createGitWorkflows({
        baseFolder: defaultFolder,
        baseRoot: '',
        projectType,
      })
      assert(
        response,
        `expected both 'ci.yml' and 'publish.yml' to be created for projectType '${projectType}'`,
      )

      // deno-lint-ignore no-await-in-loop
      const ciContent = await Deno.readTextFile(defaultFolder + '/ci.yml')
      // deno-lint-ignore no-await-in-loop
      const publishContent = await Deno.readTextFile(defaultFolder + '/publish.yml')

      assert(ciContent.includes('run: deno fmt --check'))
      assert(ciContent.includes('run: deno lint'))
      assert(ciContent.includes('run: deno run -A jsr:@zanix/cli check-cycles'))
      assertFalse(ciContent.includes('Run tests'))
      assertFalse(ciContent.includes('Publish to Deno'))

      assert(publishContent.includes('run: deno test --allow-all'))
      assert(publishContent.includes('Publish to Deno'))
      assertFalse(publishContent.includes('Check for circular-import hazards'))
      assert(
        publishContent.includes('uses: ./.github/workflows/ci.yml'),
        `expected 'publish.yml' to call 'ci.yml' as a reusable workflow for projectType '${projectType}'`,
      )
      assert(
        /needs:\s*ci\b/.test(publishContent),
        `expected the 'publish' job to declare 'needs: ci' for projectType '${projectType}'`,
      )

      // deno-lint-ignore no-await-in-loop
      await Deno.remove(defaultFolder, { recursive: true })
    }
  },
)

Deno.test('Github create gitignorefile validation', async () => {
  // Call the function passing the file type, for example 'ts'
  const response = await createIgnoreBaseFile({ baseRoot: defaultFolder })
  assert(response)

  assert(fileExists(defaultFolder + '/.gitignore'))

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create gitignorefile skips creation when the file already exists', async () => {
  await createIgnoreBaseFile({ baseRoot: defaultFolder })
  const response = await createIgnoreBaseFile({ baseRoot: defaultFolder })

  assertFalse(response)

  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github create gitignorefile rejects when base root creation fails', async () => {
  // A genuine `Deno.mkdir` failure — not the benign "already exists" skip — so this now rejects
  // instead of silently resolving `false`; locks in the fix that made `createBaseFile`'s catch
  // re-throw instead of swallowing every failure into the same `false` a caller can't tell apart
  // from "nothing went wrong, just skipped."
  const blockerFile = defaultFolder + '-blocker'
  await Deno.writeTextFile(blockerFile, '') // a file, not a directory, blocks `Deno.mkdir`

  await assertRejects(() => createIgnoreBaseFile({ baseRoot: blockerFile }))

  await Deno.remove(blockerFile)
})

Deno.test('Github prepare validation with legacy hooks', async () => {
  const baseFolder = defaultFolder + '/prepare'
  // Call the function passing the file type, for example 'ts'
  const response = await prepareGithub({
    root: defaultFolder,
    legacyHooks: {
      preCommit: { baseFolder, baseRoot: '', createLink: false },
      prePush: { baseFolder, baseRoot: '', createLink: false },
    },
    publishWorkflow: { baseFolder: defaultFolder, baseRoot: '' },
    gitIgnoreBase: { baseRoot: baseFolder },
  })

  assert(response && response.length && !response.includes(false))

  assert(fileExists(baseFolder + '/pre-commit'))
  assert(fileExists(baseFolder + '/pre-push'))
  assert(fileExists(defaultFolder + '/publish.yml'))
  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github prepare validation with pre commit framework', async () => {
  const baseFolder = defaultFolder + '/prepare'
  // Call the function passing the file type, for example 'ts'
  const response = await prepareGithub({
    root: defaultFolder,
    usePrecommit: { baseRoot: baseFolder },
    legacyHooks: {
      preCommit: { baseFolder, baseRoot: '', createLink: false },
      prePush: { baseFolder, baseRoot: '', createLink: false },
    },
    publishWorkflow: { baseFolder: defaultFolder, baseRoot: '' },
    gitIgnoreBase: { baseRoot: baseFolder },
  })

  assert(response && response.length && !response.includes(false))

  assert(fileExists(baseFolder + '/.pre-commit-config.yaml'))
  assert(fileExists(baseFolder + '/pre-commit'))
  assert(fileExists(baseFolder + '/pre-push'))
  assert(fileExists(defaultFolder + '/publish.yml'))
  await new Deno.Command('pre-commit', {
    args: ['uninstall'],
    cwd: baseFolder,
  }).output()
  await Deno.remove(defaultFolder, { recursive: true })
})

Deno.test('Github prepare validation with usePrecommit as a boolean flag', async () => {
  const baseFolder = defaultFolder + '/prepare-bool'
  await Deno.mkdir(baseFolder, { recursive: true })
  // `usePrecommit: true` falls back to the default root, so cwd is redirected to a safe temp dir
  const cwdMock = stub(Deno, 'cwd', () => baseFolder)

  try {
    const response = await prepareGithub({
      root: defaultFolder,
      usePrecommit: true,
      legacyHooks: {
        preCommit: { baseFolder, baseRoot: '', createLink: false },
        prePush: { baseFolder, baseRoot: '', createLink: false },
      },
      publishWorkflow: { baseFolder: defaultFolder, baseRoot: '' },
      gitIgnoreBase: { baseRoot: baseFolder },
    })

    assert(response && response.length && !response.includes(false))
    assert(fileExists(baseFolder + '/.pre-commit-config.yaml'))
  } finally {
    await new Deno.Command('pre-commit', {
      args: ['uninstall'],
      cwd: baseFolder,
    }).output()
    cwdMock.restore()
    await Deno.remove(defaultFolder, { recursive: true })
  }
})

Deno.test('Git init should be executed', async () => {
  assertEquals(
    await gitInitialization(defaultFolder),
    defaultFolder + '/.git/hooks',
  )
  assert(folderExists(defaultFolder + '/.git'))

  await Deno.remove(defaultFolder, { recursive: true })
})
